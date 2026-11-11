// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../../src/index.js";
import { createRuntime } from "../../src/runtime.js";
import type { ResourceContext } from "../../src/types.js";

const descriptor = query({
	resource: "items",
	mode: "one",
	identity: "x",
	select: ["a", "b"],
});
const fact = (values: Record<string, unknown>, identity = "x") => ({
	resource: "items",
	identity,
	values,
	basis: ["public"],
});
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

test("old invalidations and membership fragments cannot downgrade newer values or resurrect a deleted target", () => {
	let context!: ResourceContext;
	const runtime = createRuntime({
		resources: [
			{
				name: "items",
				event: (_event, captured) => {
					context = captured;
				},
			},
		],
	});
	const handle = runtime.watch(
		query({ resource: "items", mode: "list", select: ["a", "b"] }),
	);
	try {
		runtime.event("items", "capture");
		context.observe({
			facts: [{ ...fact({ a: "first", b: "first" }), presence: "present" }],
		});
		runtime.observe({
			facts: [
				{ ...fact({ a: "current", b: "current" }, "y"), presence: "present" },
				{
					resource: "items",
					identity: "x",
					presence: "absent",
					basis: ["public"],
				},
			],
		});
		context.observe({ facts: [fact({ a: "own progress" }, "z")] });
		context.observe({
			facts: [
				{ ...fact({ a: "obsolete", b: "obsolete" }), presence: "present" },
			],
			invalidate: [{ resource: "items", identity: "y", field: "b" }],
			memberships: [
				{
					resource: "items",
					identities: ["x"],
					complete: true,
					basis: ["public"],
				},
			],
		});
		const result = handle.getSnapshot();
		assert.equal(
			result.rows.some((row) => row.data.a === "obsolete"),
			false,
		);
		assert.equal(
			result.rows.find((row) => row.data.a === "current")?.fields.b?.stale,
			undefined,
		);
		assert.equal(result.confirmed.complete, false);
	} finally {
		handle.dispose();
		runtime.close();
	}
});

test("later acquisition fragments retain newer event evidence while replacing their own earlier fields", async () => {
	const entered = deferred();
	const release = deferred();
	const runtime = createRuntime({
		resources: [
			{
				name: "items",
				access: () => "public",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["a", "b"],
						run: async (_query, context) => {
							entered.resolve();
							await release.promise;
							context.observe({ facts: [fact({ a: "first fragment" })] });
							return {
								facts: [fact({ a: "last fragment", b: "older response" })],
							};
						},
					},
				],
			},
		],
	});
	try {
		const pending = runtime.read(descriptor);
		await entered.promise;
		runtime.observe({ facts: [fact({ b: "newer event" })] });
		release.resolve();
		assert.deepEqual((await pending).rows[0]?.data, {
			a: "last fragment",
			b: "newer event",
		});
	} finally {
		runtime.close();
	}
});

test("competing contexts remain distinguishable across additional own fragments and membership publication", () => {
	const contexts: ResourceContext[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "items",
				event: (_event, context) => {
					contexts.push(context);
				},
			},
		],
	});
	const handle = runtime.watch(
		query({ resource: "items", mode: "list", select: ["a", "b"] }),
	);
	try {
		runtime.event("items", "first");
		runtime.event("items", "second");
		const [first, second] = contexts;
		assert.ok(first && second);
		first.observe({ facts: [fact({ a: "first" })] });
		second.observe({
			facts: [
				fact({ b: "competing" }),
				{
					...fact({ a: "new member", b: "new member" }, "y"),
					presence: "present",
				},
			],
		});
		first.observe({ facts: [fact({ a: "second" })] });
		first.observe({
			facts: [fact({ b: "older" })],
			memberships: [
				{
					resource: "items",
					identities: ["x"],
					complete: true,
					basis: ["public"],
				},
			],
		});
		const result = handle.getSnapshot();
		assert.equal(
			result.rows.find((row) => row.data.a === "second")?.data.b,
			"competing",
		);
		assert.equal(result.rows.length, 2);
		assert.equal(result.confirmed.complete, false);
	} finally {
		handle.dispose();
		runtime.close();
	}
});

test("a reentrant subscriber write does not become part of the publishing context's own revisions", () => {
	let context!: ResourceContext;
	const runtime = createRuntime({
		resources: [
			{
				name: "items",
				event: (_event, captured) => {
					context = captured;
				},
			},
		],
	});
	const handle = runtime.watch(descriptor);
	let inserted = false;
	const stop = runtime.subscribe(() => {
		if (inserted || handle.getSnapshot().rows[0]?.data.a !== "first") return;
		inserted = true;
		runtime.observe({ facts: [fact({ b: "subscriber event" })] });
	});
	try {
		runtime.event("items", "capture");
		context.observe({ facts: [fact({ a: "first" })] });
		context.observe({ facts: [fact({ b: "older fragment" })] });
		assert.equal(handle.getSnapshot().rows[0]?.data.b, "subscriber event");
	} finally {
		stop();
		handle.dispose();
		runtime.close();
	}
});

test("basis capture cannot adopt a grant retired after the context began but supports its own newly established grants", () => {
	let context!: ResourceContext;
	const runtime = createRuntime({
		access: [{ scope: "protected", state: "allowed" }],
		resources: [
			{
				name: "items",
				event: (_event, captured) => {
					context = captured;
				},
			},
		],
	});
	const handle = runtime.watch(descriptor);
	try {
		runtime.event("items", "capture");
		const original = context.basis("protected");
		runtime.revoke("protected");
		runtime.setAccess({
			decisions: [{ scope: "protected", state: "allowed" }],
		});
		assert.deepEqual(context.basis("protected"), original);
		context.observe({
			facts: [
				{
					...fact({ b: "retired response" }),
					basis: [context.basis("protected")],
				},
			],
		});
		assert.equal(handle.getSnapshot().rows.length, 0);
		context.grant("new disclosure", "allowed");
		context.observe({
			facts: [
				{
					...fact({ a: "permitted" }),
					basis: [context.basis("new disclosure")],
				},
			],
		});
		assert.equal(handle.getSnapshot().rows[0]?.data.a, "permitted");
	} finally {
		handle.dispose();
		runtime.close();
	}
});

test("a later relationship fragment cannot replace a competing relationship update", () => {
	const contexts: ResourceContext[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "items",
				event: (_event, context) => {
					contexts.push(context);
				},
			},
		],
	});
	const relation = (target: string) => ({
		resource: "items",
		identity: "x",
		relationship: "uses",
		targets: [{ resource: "items", identity: target }],
		complete: true,
		basis: ["public"],
	});
	try {
		runtime.event("items", "first");
		runtime.event("items", "second");
		const [first, second] = contexts;
		assert.ok(first && second);
		first.observe({ facts: [fact({ a: "first" })] });
		second.observe({ relationships: [relation("new")] });
		first.observe({ facts: [fact({ a: "second" })] });
		first.observe({ relationships: [relation("old")] });
		assert.deepEqual(runtime.relationship("items", "x", "uses")?.targets, [
			{ resource: "items", identity: "new" },
		]);
	} finally {
		runtime.close();
	}
});
