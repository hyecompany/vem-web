// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { commandKey } from "../../src/descriptors.js";
import {
	defineCommand,
	defineEdit,
	defineResource,
	stableKey,
} from "../../src/index.js";
import { createRuntime } from "../../src/runtime.js";

interface Task {
	title: string;
	status: "open" | "closed";
	priority: number;
}
interface Ref {
	workspace: string;
	id: string;
}
const tasks = defineResource<Task, Ref, { workspace: string }>()({
	name: "tasks",
	fields: ["title", "status", "priority"],
	defaultSelect: ["title", "status"],
	defaultScope: { workspace: "default" },
	scopeOf: (ref) => ({ workspace: ref.workspace }),
	commands: {
		rename: defineCommand<
			{ title: string },
			{ kind: "succeeded"; value: string }
		>(),
		upload: defineCommand<{ file: Blob }>(),
	},
	edits: { details: defineEdit<{ title: string }>() },
});

test("bound descriptions retain selection and identity scope across aliases and inline calls", () => {
	const { list, get } = tasks;
	assert.deepEqual(list().scope, { workspace: "default" });
	assert.deepEqual(list().select, ["status", "title"]);
	const ref = { workspace: "team", id: "a" };
	assert.deepEqual(get(ref).scope, { workspace: "team" });
	assert.deepEqual(get(ref, { scope: { workspace: "explicit" } }).scope, {
		workspace: "explicit",
	});
	assert.equal(
		stableKey(list({ select: ["title", "priority"] })),
		stableKey(tasks.list({ select: ["priority", "title", "title"] })),
	);
	const descriptor = get(ref, { select: ["priority"] });
	ref.workspace = "changed";
	assert.deepEqual(descriptor.identity, { workspace: "team", id: "a" });
	assert.deepEqual(descriptor.scope, { workspace: "team" });
	assert.throws(
		() => get(ref, { select: ["invalid" as "title"] }),
		/Unknown tasks field/,
	);
});

test("selected complete rows contain only the fields promised by the named description", async () => {
	const runtime = createRuntime({
		access: [{ scope: "read", state: "allowed" }],
		resources: [
			{
				name: tasks.name,
				access: () => "read",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["title", "status", "priority"],
						membership: true,
						run: async (descriptor) => ({
							facts: [
								{
									resource: tasks.name,
									identity: { workspace: "default", id: "a" },
									presence: "present",
									values: { title: "One", status: "open", priority: 3 },
									basis: ["read"],
								},
							],
							memberships: [
								{
									resource: tasks.name,
									scope: descriptor.scope,
									identities: [{ workspace: "default", id: "a" }],
									complete: true,
									basis: ["read"],
								},
							],
						}),
					},
				],
			},
		],
	});
	try {
		const result = await runtime.read(tasks.list({ select: ["title"] }));
		assert.equal(result.rows[0]?.complete, true);
		assert.deepEqual(result.rows[0]?.data, { title: "One" });
		assert.equal(result.confirmed.total, 1);
	} finally {
		runtime.close();
	}
});

test("queued commands and editors capture the target and input supplied to their descriptions", async () => {
	const runtime = createRuntime({
		resources: [
			{
				name: tasks.name,
				commands: {
					rename: {
						disclosure: "public",
						run: async (descriptor) => ({
							kind: "succeeded",
							value: `${(descriptor.target as Ref).id}:${(descriptor.input as { title: string }).title}`,
						}),
					},
				},
			},
		],
	});
	try {
		await runtime.ready;
		const target = { workspace: "default", id: "a" };
		const input = { title: "before" };
		const descriptor = tasks.commands.rename(target, input);
		const editor = tasks.edits.details(target);
		const handle = runtime.run(descriptor);
		target.id = "b";
		input.title = "after";
		assert.deepEqual(await handle.result, {
			kind: "succeeded",
			value: "a:before",
		});
		assert.equal(editor.target.id, "a");
		assert.equal(Object.isFrozen(descriptor.input), true);
		const file = new Blob(["payload"]);
		assert.equal(
			commandKey(tasks.commands.upload(target, { file })),
			commandKey(tasks.commands.upload(target, { file })),
		);
	} finally {
		runtime.close();
	}
});

test("framework denial remains an outcome of a success-only domain command", async () => {
	const runtime = createRuntime({
		access: [{ scope: "write", state: "denied" }],
		resources: [
			{
				name: tasks.name,
				commands: {
					rename: {
						access: () => "write",
						disclosure: () => "write",
						run: async () => {
							throw new Error("must not dispatch");
						},
					},
				},
			},
		],
	});
	try {
		const result = await runtime.run(
			tasks.commands.rename(
				{ workspace: "default", id: "a" },
				{ title: "denied" },
			),
		).result;
		assert.equal(result.kind, "failed");
		if (result.kind === "failed") assert.equal(result.submitted, false);
	} finally {
		runtime.close();
	}
});

test("invalid sampling is rejected before a query can retain a subscription", async () => {
	let acquisitions = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: tasks.name,
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["title"],
						run: async () => {
							acquisitions++;
						},
					},
				],
			},
		],
	});
	try {
		await runtime.ready;
		for (const intervalMs of [0, 99, Number.NaN, Infinity]) {
			assert.throws(
				() =>
					runtime.watch({
						...tasks.list(),
						sample: { fields: ["status"], intervalMs },
					}),
				/interval must be at least 100ms/,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(acquisitions, 0);
	} finally {
		runtime.close();
	}
});
