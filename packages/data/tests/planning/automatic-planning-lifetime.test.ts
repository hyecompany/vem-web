// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, query } from "@hyecompany/vem-data";
import {
	createRuntime,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";

const continuity = { channel: "test-events" };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const list = (select: readonly string[]) =>
	query({ resource: "tasks", mode: "list", select });
const fact = (identity: string, values: Record<string, unknown>) => ({
	liveness: continuity,
	resource: "tasks",
	identity,
	presence: "present" as const,
	values,
	basis: ["public"],
});
const membership = (identities: string[], complete = false) => ({
	liveness: continuity,
	resource: "tasks",
	identities,
	complete,
	basis: ["public"],
});

test("settled partial coverage survives unrelated observations and grants, while an actual gap reacquires", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const resource: ResourceDefinition = {
		name: "tasks",
		sources: [
			{
				key: "list",
				mode: "list",
				fields: ["title"],
				membership: true,
				run: async () => {
					calls++;
					return {
						facts: [fact("a", { title: "A" })],
						memberships: [membership(["a"])],
					};
				},
			},
		],
	};
	const runtime = createRuntime({ resources: [resource] });
	t.after(() => runtime.close());
	const handle = runtime.watch(list(["title"]));
	t.after(handle.subscribe(() => undefined));
	assert.equal(
		(await runtime.read(list(["title"]))).issues[0]?.kind,
		"incomplete",
	);
	runtime.observe({ facts: [fact("a", { unrelated: 1 })] });
	runtime.setAccess({
		decisions: [{ scope: "unrelated-events", state: "allowed" }],
	});
	await tick();
	assert.equal(calls, 1);
	runtime.setContinuity(continuity, "interrupted");
	await runtime.read(list(["title"]));
	assert.equal(calls, 2);
});

test("a partial fixed representation does not repeat itself, but a new identity can need that source", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "list",
						mode: "list",
						fields: ["title", "notes"],
						membership: true,
						run: async () => {
							calls++;
							return calls === 1
								? {
										facts: [fact("a", { title: "A" })],
										memberships: [membership(["a"], true)],
									}
								: {
										facts: [
											fact("a", { notes: "A notes" }),
											fact("b", { notes: "B notes" }),
										],
										memberships: [membership(["a", "b"], true)],
									};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = list(["title", "notes"]);
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	assert.equal((await runtime.read(descriptor)).rows[0]?.complete, false);
	assert.equal(calls, 1);
	runtime.observe({ facts: [fact("b", { title: "B" })] });
	await runtime.read(descriptor);
	assert.equal(calls, 2);
	assert.equal(
		handle.getSnapshot().rows.every((row) => row.complete),
		true,
	);
});

test("a precise invalidation retries the affected unmet field without a background verification loop", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const descriptor = query({
		resource: "tasks",
		mode: "one",
		identity: "a",
		select: ["title", "notes"],
	});
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "one",
						mode: "one",
						fields: ["title", "notes"],
						run: async () => {
							calls++;
							return { facts: [fact("a", { title: "A" })] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	await runtime.read(descriptor);
	assert.equal(calls, 1);
	runtime.observe({
		invalidate: [{ resource: "tasks", identity: "a", field: "notes" }],
	});
	await runtime.read(descriptor);
	assert.equal(calls, 2);
	await tick();
	assert.equal(calls, 2);
});

test("cold collection derived fields can discover identities before reusing known prerequisites", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				fieldDependencies: {
					owner: (identity) => [
						query({
							resource: "tasks",
							mode: "one",
							identity,
							select: ["name"],
						}),
					],
				},
				derive: (_changed, context) => ({
					facts: context
						.records("tasks")
						.filter((record) => record.values.name && !record.values.owner)
						.map((record) => ({
							liveness: continuity,
							resource: "tasks",
							identity: record.identity,
							values: { owner: "team" },
							basis: ["public"],
							dependsOn: [
								{ resource: "tasks", identity: record.identity, field: "name" },
							],
						})),
				}),
				sources: [
					{
						key: "urls",
						mode: "list",
						fields: ["name"],
						membership: true,
						cost: 0.25,
						run: async () => {
							calls.push("urls");
							return {
								facts: [fact("a", { name: "A" })],
								memberships: [membership(["a"], true)],
							};
						},
					},
					{
						key: "full",
						mode: "list",
						fields: ["name", "owner"],
						membership: true,
						cost: 2,
						run: async () => {
							calls.push("full");
							return {
								facts: [fact("a", { name: "A", owner: "team" })],
								memberships: [membership(["a"], true)],
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(list(["name", "owner"]));
	assert.deepEqual(calls, ["urls"]);
	assert.equal(result.rows[0]?.data.owner, "team");
});

test("establishing initially unknown source authority does not repeat its partial acquisition", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "list",
						mode: "list",
						fields: ["title"],
						membership: true,
						access: "service",
						run: async (_request, context) => {
							calls++;
							context.grant("service", "allowed");
							return {
								facts: [fact("a", { title: "A" })],
								memberships: [membership(["a"])],
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	await runtime.read(list(["title"]));
	assert.equal(calls, 1);
});

test("derived-only collection, presence and fields share their parent representation", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const parent = () =>
		query({
			resource: "parents",
			mode: "one",
			identity: "p",
			select: ["children"],
		});
	const runtime = createRuntime({
		resources: [
			{
				name: "parents",
				sources: [
					{
						key: "full",
						mode: "one",
						fields: ["children"],
						run: async () => {
							calls++;
							return {
								facts: [
									{
										liveness: continuity,
										resource: "parents",
										identity: "p",
										presence: "present",
										values: { children: ["a"] },
										basis: ["public"],
									},
									fact("a", { title: "A" }),
								],
								memberships: [membership(["a"], true)],
							};
						},
					},
				],
			},
			{
				name: "tasks",
				fieldDependencies: { title: () => [parent()] },
				presenceDependencies: () => [parent()],
				membershipDependencies: () => [parent()],
			},
		],
	});
	t.after(() => runtime.close());
	const results = await Promise.all([
		runtime.read(parent()),
		runtime.read(list(["title"])),
		runtime.read(
			query({
				resource: "tasks",
				mode: "one",
				identity: "a",
				select: ["title"],
			}),
		),
	]);
	assert.equal(calls, 1);
	assert.equal(
		results.every((result) => result.rows[0]?.complete),
		true,
	);
});

test("source dispatch respects a read work limit and retry continues with missing information", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		maxAcquisitionsPerRead: 2,
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["title"],
						run: async (request) => {
							calls++;
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
	runtime.observe({ memberships: [membership(["a", "b", "c", "d"], true)] });
	const descriptor = list(["title"]);
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	const partial = await runtime.read(descriptor);
	assert.equal(calls, 2);
	assert.match(partial.issues[0]?.message ?? "", /limit of 2/);
	const complete = await handle.retry();
	assert.equal(calls, 4);
	assert.equal(
		complete.rows.every((row) => row.complete),
		true,
	);
});

test("paginated acquisition stops once its point consumer has the requested information", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "pages",
						mode: "list",
						fields: ["title"],
						membership: true,
						pagination: { pageSize: 1 },
						run: async () => {
							calls++;
							return {
								batch: {
									facts: [fact("a", { title: "A" })],
									memberships: [membership(["a"])],
								},
								next: "unneeded-next-page",
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(
		query({ resource: "tasks", mode: "one", identity: "a", select: ["title"] }),
	);
	assert.equal(result.rows[0]?.data.title, "A");
	assert.equal(calls, 1);
});

test("paginated acquisition stops after all interested consumers detach", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	let release: () => void = () => undefined;
	const response = new Promise<void>((resolve) => {
		release = resolve;
	});
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "pages",
						mode: "list",
						fields: ["title"],
						membership: true,
						pagination: { pageSize: 1 },
						run: async () => {
							calls++;
							await response;
							return {
								batch: {
									facts: [fact("a", { title: "A" })],
									memberships: [membership(["a"])],
								},
								next: "unobserved-page",
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const handle = runtime.watch(list(["title"]));
	const unsubscribe = handle.subscribe(() => undefined);
	await tick();
	assert.equal(calls, 1);
	unsubscribe();
	handle.dispose();
	release();
	await tick();
	assert.equal(calls, 1);
});

test("invalidated incomplete relationships reacquire before a derived value has ever existed", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const relation = { resource: "tasks", identity: "a", relationship: "tags" };
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				fieldDependencies: { label: () => [relation] },
				derive: (_changed, context) =>
					context.relationship("tasks", "a", "tags")?.complete
						? {
								facts: [
									{
										...fact("a", { label: "Established" }),
										dependsOn: [relation],
									},
								],
							}
						: undefined,
				sources: [
					{
						key: "tags",
						mode: "one",
						fields: [],
						relationships: ["tags"],
						run: async () => {
							calls++;
							return {
								facts: [fact("a", {})],
								relationships: [
									{
										...relation,
										targets: [],
										complete: calls > 1,
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
		resource: "tasks",
		mode: "one",
		identity: "a",
		select: ["label"],
	});
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	const partial = await runtime.read(descriptor);
	assert.equal(calls, 1);
	assert.equal(partial.rows[0]?.complete, false);
	runtime.observe({ invalidate: [relation] });
	const complete = await runtime.read(descriptor);
	assert.equal(calls, 2);
	assert.equal(complete.rows[0]?.data.label, "Established");
});

test("an unavailable collection source does not repeatedly retry an undiscovered dependency identity", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		maxAcquisitionsPerRead: 8,
		resources: [
			{
				name: "parents",
				sources: [
					{
						key: "full",
						mode: "list",
						fields: ["children"],
						membership: true,
						run: async () => {
							calls++;
							throw new Error("Parent unavailable");
						},
					},
				],
			},
			{
				name: "tasks",
				fieldDependencies: {
					notes: () => [
						query({
							resource: "parents",
							mode: "one",
							identity: "missing-parent",
							select: ["children"],
						}),
					],
				},
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { title: "A" })] });
	const result = await runtime.read(
		query({
			resource: "tasks",
			mode: "one",
			identity: "a",
			select: ["title", "notes"],
		}),
	);
	assert.equal(calls, 1);
	assert.equal(result.rows[0]?.complete, false);
	assert.equal(result.settled, true);
});

test("source admission and action disclosure resolve current canonical ownership from knowledge", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		access: [
			{ scope: "alias", state: "allowed" },
			{ scope: "view:canonical", state: "denied" },
		],
		resources: [
			{ name: "projects" },
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["title"],
						access: (_request, context) => ({
							all: [
								"alias",
								`view:${context.get("projects", "tenant")?.values.owner}`,
							],
						}),
						run: async () => {
							calls++;
							return { facts: [fact("a", { title: "A" })] };
						},
					},
				],
				commands: {
					save: {
						disclosure: (_command, context) => ({
							all: [
								"alias",
								`view:${context.get("projects", "tenant")?.values.owner}`,
							],
						}),
						run: async () => ({ kind: "succeeded" }),
					},
				},
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "projects",
				identity: "tenant",
				values: { owner: "canonical" },
				basis: ["public"],
			},
		],
	});
	const descriptor = query({
		resource: "tasks",
		mode: "one",
		identity: "a",
		select: ["title"],
	});
	assert.equal((await runtime.read(descriptor)).issues[0]?.kind, "access");
	assert.equal(calls, 0);
	runtime.setAccess({
		decisions: [{ scope: "view:canonical", state: "allowed" }],
	});
	assert.equal((await runtime.read(descriptor)).rows[0]?.data.title, "A");
	assert.equal(calls, 1);
	await runtime.run(
		command({ resource: "tasks", name: "save", target: "a", input: undefined }),
	).result;
	assert.equal(runtime.listActivities().length, 1);
	runtime.revoke("view:canonical");
	assert.equal(runtime.listActivities().length, 0);
});

test("a formerly nonmatching identity creates fresh demand within an incomplete filtered collection", {
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
						fields: ["title", "notes", "status"],
						membership: true,
						filters: ["status"],
						available: (request) => request.where?.status === "open",
						run: async (request) => {
							calls++;
							return {
								facts:
									calls === 1
										? [fact("a", { title: "A", status: "open" })]
										: [
												fact("c", {
													title: "C",
													status: "open",
													notes: "Now relevant",
												}),
											],
								memberships: [
									{
										...membership(calls === 1 ? ["a"] : ["a", "c"]),
										where: request.where,
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
	runtime.observe({ facts: [fact("c", { title: "C", status: "done" })] });
	const descriptor = query({
		resource: "tasks",
		mode: "list",
		select: ["title", "notes"],
		where: { status: "open" },
	});
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	await runtime.read(descriptor);
	assert.equal(calls, 1);
	runtime.observe({ facts: [fact("c", { status: "open" })] });
	const result = await runtime.read(descriptor);
	assert.equal(calls, 2);
	assert.equal(
		result.rows.some((row) => row.data.notes === "Now relevant"),
		true,
	);
});

test("retry continues to alternate sources after an earlier source fails", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	let recovered = false;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "cheap",
						mode: "one",
						fields: ["notes"],
						cost: 1,
						run: async () => {
							calls.push("cheap");
							throw new Error("Unavailable");
						},
					},
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						cost: 2,
						run: async () => {
							calls.push("detail");
							return {
								facts: [fact("a", recovered ? { notes: "Recovered" } : {})],
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = query({
		resource: "tasks",
		mode: "one",
		identity: "a",
		select: ["notes"],
	});
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	const partial = await runtime.read(descriptor);
	assert.equal(partial.rows[0]?.complete, false);
	assert.deepEqual(calls, ["cheap", "detail"]);
	recovered = true;
	const result = await handle.retry();
	assert.deepEqual(calls, ["cheap", "detail", "cheap", "detail"]);
	assert.equal(result.rows[0]?.data.notes, "Recovered");
	assert.equal(result.confirmed.complete, true);
	assert.deepEqual(result.issues, []);
});

test("a response discovering a never-granted denial does not repeat public partial acquisition", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "list",
						mode: "list",
						fields: ["title"],
						membership: true,
						access: "public",
						run: async () => {
							calls++;
							return calls === 1
								? { memberships: [membership([])] }
								: {
										grants: [
											{ scope: "task:a:public", state: "denied" as const },
										],
										facts: [fact("a", { title: "A" })],
										memberships: [membership(["a"])],
									};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = list(["title"]);
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	await runtime.read(descriptor);
	assert.equal(calls, 1);
	runtime.setContinuity(continuity, "interrupted");
	const result = await runtime.read(descriptor);
	assert.equal(calls, 2);
	assert.equal(result.rows[0]?.data.title, "A");
	assert.equal(result.confirmed.complete, false);
	assert.equal(runtime.access("task:a:public"), "denied");
});
