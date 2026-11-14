// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	type AcquisitionPage,
	createRuntime,
} from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";
import { fact, list } from "../support/acquisition.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100 && !predicate(); i++) await tick();
	assert.ok(predicate(), "Expected source progress");
}
test("supported server filters compose with local predicates without proving broader collection coverage", {
	timeout: 5000,
}, async (t) => {
	const sent: unknown[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: () => "public",
				sources: [
					{
						key: "filtered",
						mode: "list",
						fields: ["title", "assignee"],
						membership: true,
						filters: ["status"],
						run: async (request) => {
							sent.push(request.where);
							const identities =
								request.where?.status === "open" ? ["a", "b"] : ["a", "b", "c"];
							return {
								facts: identities.map((id) =>
									fact(id, {
										title: id,
										assignee: id === "b" ? "other" : "me",
									}),
								),
								memberships: [
									{
										resource: "tasks",
										where: request.where,
										identities,
										complete: true,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const subset = await runtime.read(
		query({ ...list, where: { status: "open", assignee: "me" } }),
	);
	assert.deepEqual(sent, [{ status: "open" }]);
	assert.equal(subset.confirmed.complete, true);
	assert.deepEqual(
		subset.rows.map((row) => row.data.title),
		["a"],
	);
	const open = await runtime.read(
		query({ ...list, where: { status: "open" } }),
	);
	assert.equal(open.confirmed.complete, true);
	assert.equal(open.rows.length, 2);
	assert.equal(sent.length, 1);
	const all = await runtime.read(list);
	assert.equal(all.confirmed.complete, true);
	assert.equal(all.rows.length, 3);
	assert.equal(sent.length, 2);
});

test("runtime follows pages and only the final page establishes accumulated membership", {
	timeout: 5000,
}, async (t) => {
	const last = deferred<AcquisitionPage>();
	const cursors: unknown[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: () => "public",
				sources: [
					{
						key: "pages",
						mode: "list",
						fields: ["title"],
						membership: true,
						pagination: { pageSize: 1, maxPages: 5 },
						run: async (request) => {
							cursors.push(request.page?.cursor);
							assert.equal(request.page?.limit, 1);
							if (request.page?.cursor !== undefined) return last.promise;
							return {
								batch: {
									facts: [fact("a", { title: "A" })],
									memberships: [
										{
											resource: "tasks",
											identities: ["a"],
											complete: false,
											basis: ["public"],
										},
									],
								},
								next: "second",
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const handle = runtime.watch(list);
	t.after(handle.subscribe(() => undefined));
	await until(() => cursors.length === 2);
	assert.equal(handle.getSnapshot().rows[0]?.data.title, "A");
	assert.equal(handle.getSnapshot().confirmed.complete, false);
	last.resolve({
		batch: {
			facts: [fact("b", { title: "B" })],
			memberships: [
				{
					resource: "tasks",
					identities: ["b"],
					complete: true,
					basis: ["public"],
				},
			],
		},
	});
	const result = await runtime.read(list);
	assert.equal(result.confirmed.complete, true);
	assert.deepEqual(result.rows.map((row) => row.data.title).sort(), ["A", "B"]);
	assert.deepEqual(cursors, [undefined, "second"]);
});

test("pagination bounds settle incomplete results without inventing an empty or complete collection", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: () => "public",
				sources: [
					{
						key: "pages",
						mode: "list",
						fields: ["title"],
						membership: true,
						pagination: { pageSize: 1, maxPages: 2 },
						run: async () => {
							const identity = String(++calls);
							return {
								batch: {
									facts: [fact(identity, { title: identity })],
									memberships: [
										{
											resource: "tasks",
											identities: [identity],
											complete: false,
											basis: ["public"],
										},
									],
								},
								next: identity,
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(list);
	assert.equal(calls, 2);
	assert.equal(result.settled, true);
	assert.equal(result.confirmed.complete, false);
	assert.equal(result.empty, false);
	assert.equal(result.rows.length, 2);
});

test("custom predicate terms do not imply equality-filter containment", (t) => {
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				matches: (values, where) =>
					Object.entries(where).some(
						([field, expected]) => values[field] === expected,
					),
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			fact("a", { title: "A", status: "open", assignee: "other" }),
			fact("b", { title: "B", status: "done", assignee: "me" }),
		],
		memberships: [
			{
				resource: "tasks",
				where: { status: "open" },
				identities: ["a"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	const result = runtime
		.watch(query({ ...list, where: { status: "open", assignee: "me" } }))
		.getSnapshot();
	assert.equal(result.confirmed.complete, false);
	assert.deepEqual(result.rows.map((row) => row.data.title).sort(), ["A", "B"]);
});

test("source authority is rechecked before a pagination continuation", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		access: [{ scope: "service", state: "allowed" }],
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "pages",
						mode: "list",
						fields: ["title"],
						membership: true,
						access: "service",
						pagination: { pageSize: 1 },
						run: async () => {
							calls++;
							return {
								batch: {
									facts: [fact("a", { title: "A" })],
									memberships: [
										{
											resource: "tasks",
											identities: ["a"],
											complete: false,
											basis: ["public"],
										},
									],
								},
								next: "second",
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const handle = runtime.watch(list);
	let revoked = false;
	t.after(
		handle.subscribe(() => {
			if (!revoked && handle.getSnapshot().rows.length > 0) {
				revoked = true;
				runtime.revoke("service");
			}
		}),
	);
	const result = await runtime.read(list);
	assert.equal(calls, 1);
	assert.equal(result.settled, true);
	assert.equal(result.confirmed.complete, false);
	assert.equal(result.rows[0]?.data.title, "A");
});

test("local predicate changes retain independent server-filter membership evidence", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "open",
						mode: "list",
						filters: ["status"],
						fields: ["title", "assignee"],
						membership: true,
						run: async (request) => {
							calls++;
							return {
								facts: [
									fact("a", { title: "A", assignee: "me" }),
									fact("b", { title: "B", assignee: "other" }),
								],
								memberships: [
									{
										resource: "tasks",
										where: request.where,
										identities: ["a", "b"],
										complete: true,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = query({
		...list,
		where: { status: "open", assignee: "me" },
	});
	assert.equal((await runtime.read(descriptor)).confirmed.knownCount, 1);
	runtime.observe({
		facts: [
			{
				resource: "tasks",
				identity: "b",
				values: { assignee: "me" },
				basis: ["public"],
			},
		],
	});
	const updated = await runtime.read(descriptor);
	assert.equal(updated.confirmed.complete, true);
	assert.equal(updated.confirmed.knownCount, 2);
	assert.equal(updated.unresolved.length, 0);
	assert.equal(calls, 1);
});

test("filtered pages retain each page's field and collection continuity", {
	timeout: 5000,
}, async (t) => {
	const first = { channel: "first-page" };
	const second = { channel: "second-page" };
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: "public",
				sources: [
					{
						key: "filtered-pages",
						mode: "list",
						fields: [],
						membership: true,
						filters: ["status"],
						pagination: { pageSize: 1, maxPages: 2 },
						run: async (request) => {
							reads++;
							const last = request.page?.cursor === "second";
							return {
								batch: {
									memberships: [
										{
											resource: "tasks",
											where: request.where,
											identities: [last ? "b" : "a"],
											complete: last,
											basis: ["public"],
											liveness: last ? second : first,
										},
									],
								},
								...(last ? {} : { next: "second" }),
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.setContinuity(first, "live");
	runtime.setContinuity(second, "live");
	const descriptor = query({
		resource: "tasks",
		mode: "list",
		select: ["status"],
		where: { status: "open" },
	});
	const result = await runtime.read(descriptor);
	assert.equal(reads, 2);
	assert.equal(result.confirmed.complete, true);
	assert.equal(result.rows.length, 2);
	const field = (identity: string) =>
		runtime
			.readModelSnapshot()
			.records.find((row) => row.confirmed?.identity === identity)?.confirmed
			?.fields.status;
	assert.equal(field("a")?.liveness, "live");
	assert.equal(field("b")?.liveness, "live");
	runtime.setContinuity(first, "interrupted");
	assert.equal(field("a")?.stale, true);
	assert.equal(field("b")?.stale, undefined);
	assert.equal(field("b")?.liveness, "live");
	assert.equal(
		runtime.watch(descriptor).getSnapshot().confirmed.complete,
		false,
	);
});

test("source costs use current permitted membership to compare shared and individual reads", async (t) => {
	for (const size of [2, 100]) {
		const calls: string[] = [];
		const identities = Array.from({ length: size }, (_, index) =>
			String(index),
		);
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					access: () => "public",
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title"],
							membership: true,
							cost: (request, context) => {
								const membership = context.membership("tasks", request.scope);
								assert.equal(membership?.identities.length, size);
								return 1 + (membership?.identities.length ?? 0) * 0.1;
							},
							run: async () => {
								calls.push("collection");
								return {
									facts: identities.map((id) => fact(id, { title: id })),
								};
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["title"],
							cost: 1,
							run: async (request) => {
								calls.push(`detail:${request.identity}`);
								return {
									facts: [
										fact(String(request.identity), { title: request.identity }),
									],
								};
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe({
			facts: identities.map((id) => fact(id, {})),
			memberships: [
				{ resource: "tasks", identities, complete: true, basis: ["public"] },
			],
		});
		const results = await Promise.all(
			["0", "1"].map((identity) =>
				runtime.read(
					query({
						resource: "tasks",
						mode: "one",
						identity,
						select: ["title"],
					}),
				),
			),
		);
		assert.ok(results.every((result) => result.confirmed.complete));
		assert.deepEqual(
			calls.sort(),
			size === 2 ? ["collection"] : ["detail:0", "detail:1"],
		);
	}
});
