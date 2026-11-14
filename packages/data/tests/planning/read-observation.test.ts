// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	AcquisitionError,
	createRuntime,
	type ObservationBatch,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const one = (identity = "a", select = ["notes"]) =>
	query({ resource: "tasks", mode: "one", identity, select });
const list = (select = ["title", "notes"]) =>
	query({ resource: "tasks", mode: "list", select });
const fact = (identity: unknown, values: Record<string, unknown>) => ({
	resource: "tasks",
	identity,
	values,
	presence: "present" as const,
	basis: ["public"],
});
const idle = {
	pending: false,
	revalidating: false,
	issues: [],
	canRetry: false,
};

test("passive queries display available evidence, settle missing data, and never start acquisition or sampling", async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							calls++;
							return { facts: [fact("a", { notes: "Read" })] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = query({
		...one(),
		sample: { fields: ["notes"], intervalMs: 100 },
	});
	const view = runtime.watch(descriptor, { acquire: false });
	t.after(view.subscribe(() => undefined));
	assert.equal(view.getSnapshot().settled, true);
	assert.equal(view.getSnapshot().confirmed.complete, false);
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(calls, 0);
	runtime.observe({ facts: [fact("a", { title: "Walk" })] });
	assert.equal(view.getSnapshot().rows.length, 1);
	assert.deepEqual(view.getSnapshot().rows[0]?.missing, ["notes"]);
	await view.retry();
	assert.equal(calls, 1);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Read");
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(calls, 1);
});

test("passive subscriptions do not retain acquiring demand, but continue to receive shared evidence", async (t) => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						run: () => response.promise,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const passive = runtime.watch(one(), { acquire: false });
	t.after(passive.subscribe(() => undefined));
	const status = runtime.watchReadStatus(list());
	let notifications = 0;
	t.after(status.subscribe(() => notifications++));
	const demand = runtime.watch(one());
	const off = demand.subscribe(() => undefined);
	await tick();
	assert.equal(status.getSnapshot().pending, true);
	off();
	assert.deepEqual(status.getSnapshot(), idle);
	assert.equal(passive.getSnapshot().settled, true);
	response.resolve({ facts: [fact("a", { notes: "Arrived" })] });
	await tick();
	assert.equal(passive.getSnapshot().rows[0]?.data.notes, "Arrived");
	assert.ok(notifications >= 2);
});

test("read status observes only demanded work and retries failed visible rows without broadening acquisition", async (t) => {
	const calls: unknown[] = [];
	const fallback = deferred<ObservationBatch>();
	let fail = true;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						cost: 1,
						mode: "one",
						fields: ["notes"],
						run: async (request) => {
							calls.push(["detail", request.identity]);
							if (fail) throw new Error("Service unavailable");
							return {
								facts: [fact(request.identity, { notes: "Available" })],
							};
						},
					},
					{
						key: "fallback",
						cost: 2,
						mode: "one",
						fields: ["notes"],
						run: (request) => {
							calls.push(["fallback", request.identity]);
							return fallback.promise;
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [fact("a", { title: "A" }), fact("b", { title: "B" })],
		memberships: [
			{
				resource: "tasks",
				identities: ["a", "b"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	const status = runtime.watchReadStatus(list());
	const snapshots: ReturnType<typeof status.getSnapshot>[] = [];
	t.after(status.subscribe(() => snapshots.push(status.getSnapshot())));
	await tick();
	assert.deepEqual(status.getSnapshot(), idle);
	assert.deepEqual(calls, []);
	const demand = runtime.watch(one());
	const off = demand.subscribe(() => undefined);
	const reading = runtime.read(one());
	await tick();
	assert.deepEqual(calls, [
		["detail", "a"],
		["fallback", "a"],
	]);
	assert.equal(status.getSnapshot().issues[0]?.message, "Service unavailable");
	assert.equal(status.getSnapshot().pending, true);
	assert.equal(status.getSnapshot().canRetry, false);
	assert.ok(
		snapshots
			.filter((snapshot) => snapshot.pending)
			.every((snapshot) => !snapshot.canRetry),
	);
	await status.retry();
	assert.equal(
		calls.length,
		2,
		"retry cannot restart an unfinished acquisition attempt",
	);
	fallback.reject(new Error("Fallback unavailable"));
	await reading;
	assert.equal(status.getSnapshot().issues[0]?.message, "Fallback unavailable");
	assert.equal(status.getSnapshot().canRetry, true);
	fail = false;
	await status.retry();
	assert.deepEqual(calls, [
		["detail", "a"],
		["fallback", "a"],
		["detail", "a"],
	]);
	assert.deepEqual(status.getSnapshot(), idle);
	assert.deepEqual(
		runtime.watch(one("b"), { acquire: false }).getSnapshot().rows[0]?.missing,
		["notes"],
	);
	off();
	assert.deepEqual(status.getSnapshot(), idle);
});

test("incomplete active reads are retryable and disappear when demand ends", async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							calls++;
							return { facts: [fact("a", {})] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const status = runtime.watchReadStatus(list());
	const demand = runtime.watch(one());
	const off = demand.subscribe(() => undefined);
	await runtime.read(one());
	assert.equal(status.getSnapshot().issues[0]?.kind, "incomplete");
	assert.equal(status.getSnapshot().canRetry, true);
	await status.retry();
	assert.equal(calls, 2);
	off();
	assert.deepEqual(status.getSnapshot(), idle);
	await status.retry();
	assert.equal(calls, 2);
});

test("read status narrows actual missing fields, identities, filters, and resource scopes", async (t) => {
	const responses = new Map([
		["red:a", deferred<ObservationBatch>()],
		["red:b", deferred<ObservationBatch>()],
	]);
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				inScope: (identity, scope) =>
					scope === undefined || String(identity).startsWith(`${scope}:`),
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["title", "notes", "done"],
						run: (request) => {
							const response = responses.get(String(request.identity));
							assert.ok(response);
							return response.promise;
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			fact("red:a", { title: "A", done: false }),
			fact("red:b", { title: "B", done: false }),
		],
		memberships: [
			{
				resource: "tasks",
				scope: "red",
				identities: ["red:a", "red:b"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	const demand = runtime.watch(query({ ...list(), scope: "red" }));
	t.after(demand.subscribe(() => undefined));
	await tick();
	const observes = (descriptor: ReturnType<typeof query>) =>
		runtime.watchReadStatus(descriptor).getSnapshot().pending;
	assert.equal(observes(list(["notes"])), true);
	assert.equal(observes(list(["title"])), false);
	assert.equal(observes(one("red:b")), true);
	assert.equal(observes(one("red:c")), false);
	assert.equal(observes(query({ ...list(), scope: "blue" })), false);
	assert.equal(
		observes(query({ ...list(), scope: "red", where: { done: true } })),
		false,
	);
	assert.equal(
		observes(query({ ...list(), scope: "red", where: { done: false } })),
		true,
	);
	assert.equal(observes(query({ ...one("red:a"), scope: "blue" })), false);
	responses
		.get("red:a")
		?.resolve({ facts: [fact("red:a", { notes: "Read" })] });
	await tick();
	assert.equal(observes(one("red:a")), false);
	assert.equal(observes(one("red:b")), true);
	responses
		.get("red:b")
		?.resolve({ facts: [fact("red:b", { notes: "Read" })] });
	await tick();
	assert.equal(observes(list()), false);
});

test("successful replacement and disclosure withdrawal remove protected read failures", async (t) => {
	const runtime = createRuntime({
		access: [{ scope: "notes", state: "allowed" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { notes: "notes" },
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							throw new Error("Protected service detail");
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { title: "A" })] });
	const status = runtime.watchReadStatus(list());
	const view = runtime.watch(one());
	t.after(view.subscribe(() => undefined));
	await runtime.read(one());
	assert.equal(status.getSnapshot().issues.length, 1);
	runtime.observe({ facts: [fact("a", { notes: "External update" })] });
	assert.deepEqual(status.getSnapshot(), idle);
	runtime.observe({
		invalidate: [{ resource: "tasks", identity: "a", field: "notes" }],
	});
	await runtime.read(one());
	assert.equal(status.getSnapshot().issues.length, 1);
	runtime.revoke("notes");
	assert.deepEqual(status.getSnapshot(), idle);
});

test("read status associates prerequisite work with the original derived field", async (t) => {
	const response = deferred<ObservationBatch>();
	const tasks: ResourceDefinition = {
		name: "tasks",
		fieldDependencies: {
			notes: (identity) => [
				query({ resource: "details", mode: "one", identity, select: ["text"] }),
			],
		},
		derive: (_changed, context) => {
			const text = context.get("details", "a")?.values.text;
			if (text === undefined) return;
			return {
				facts: [
					{
						...fact("a", { notes: text }),
						dependsOn: [{ resource: "details", identity: "a", field: "text" }],
					},
				],
			};
		},
	};
	const runtime = createRuntime({
		resources: [
			tasks,
			{
				name: "details",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["text"],
						run: () => response.promise,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { title: "A" })] });
	const status = runtime.watchReadStatus(list());
	const view = runtime.watch(one());
	t.after(view.subscribe(() => undefined));
	await tick();
	assert.equal(status.getSnapshot().pending, true);
	assert.equal(
		runtime.watchReadStatus(list(["title"])).getSnapshot().pending,
		false,
	);
	response.resolve({
		facts: [{ ...fact("a", { text: "Derived" }), resource: "details" }],
	});
	await tick();
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Derived");
	assert.deepEqual(status.getSnapshot(), idle);
});

test("stale permitted fields remain visible while matching shared work revalidates them", async (t) => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						run: () => response.promise,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			{ ...fact("a", { notes: "Cached" }), liveness: { channel: "tasks" } },
		],
	});
	runtime.setContinuity({ channel: "tasks" }, "interrupted");
	const passive = runtime.watch(one(), { acquire: false });
	t.after(passive.subscribe(() => undefined));
	const status = runtime.watchReadStatus(list());
	assert.equal(passive.getSnapshot().rows[0]?.data.notes, "Cached");
	assert.deepEqual(status.getSnapshot(), idle);
	const view = runtime.watch(one());
	t.after(view.subscribe(() => undefined));
	await tick();
	assert.equal(status.getSnapshot().pending, true);
	assert.equal(status.getSnapshot().revalidating, true);
	assert.equal(passive.getSnapshot().rows[0]?.data.notes, "Cached");
	response.resolve({ facts: [fact("a", { notes: "Fresh" })] });
	await tick();
	assert.deepEqual(status.getSnapshot(), idle);
});

test("separate field failures retain their own explanations and retry availability", async (t) => {
	let failNotes = true;
	let noteReads = 0;
	const runtime = createRuntime({
		access: [{ scope: "titles", state: "denied" }],
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "title",
						mode: "one",
						fields: ["title"],
						access: "titles",
						run: async () => {
							throw new Error("Denied sources must not run");
						},
					},
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							noteReads++;
							if (failNotes) throw new Error("Notes unavailable");
							return { facts: [fact("a", { notes: "Ready" })] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", {})] });
	const descriptor = one("a", ["title", "notes"]);
	const view = runtime.watch(descriptor);
	t.after(view.subscribe(() => undefined));
	const notes = runtime.watchReadStatus(one("a", ["notes"]));
	const title = runtime.watchReadStatus(one("a", ["title"]));
	await runtime.read(descriptor);
	assert.deepEqual(
		notes.getSnapshot().issues.map((issue) => issue.message),
		["Notes unavailable"],
	);
	assert.equal(notes.getSnapshot().canRetry, true);
	assert.deepEqual(
		title.getSnapshot().issues.map((issue) => issue.kind),
		["access"],
	);
	assert.equal(title.getSnapshot().canRetry, false);
	failNotes = false;
	await notes.retry();
	assert.equal(noteReads, 2);
	assert.deepEqual(notes.getSnapshot(), idle);
	assert.equal(title.getSnapshot().issues[0]?.kind, "access");
});

test("unsupported fields do not inherit admission failures from other selected fields", async (t) => {
	const runtime = createRuntime({
		access: [{ scope: "titles", state: "denied" }],
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "title",
						mode: "one",
						fields: ["title"],
						access: "titles",
						run: async () => undefined,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", {})] });
	const descriptor = one("a", ["title", "notes"]);
	const view = runtime.watch(descriptor);
	t.after(view.subscribe(() => undefined));
	await runtime.read(descriptor);
	const notes = runtime.watchReadStatus(one("a", ["notes"])).getSnapshot();
	assert.deepEqual(
		notes.issues.map((issue) => issue.kind),
		["unsupported"],
	);
	assert.equal(notes.canRetry, true);
});

test("stale absence and emptiness cannot hide their revalidation work", async (t) => {
	for (const mode of ["one", "list"] as const) {
		const response = deferred<ObservationBatch>();
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					sources: [
						{
							key: mode,
							mode,
							fields: [],
							membership: mode === "list",
							run: () => response.promise,
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe({
			facts: [
				{
					...fact("a", {}),
					presence: "absent",
					liveness: { channel: "tasks" },
				},
			],
			memberships: [
				{
					resource: "tasks",
					identities: [],
					complete: true,
					basis: ["public"],
					liveness: { channel: "tasks" },
				},
			],
		});
		runtime.setContinuity({ channel: "tasks" }, "interrupted");
		const status = runtime.watchReadStatus(one("a", []));
		const descriptor = mode === "one" ? one("a", []) : list([]);
		const view = runtime.watch(descriptor);
		t.after(view.subscribe(() => undefined));
		await tick();
		assert.equal(status.getSnapshot().pending, true, mode);
		assert.equal(status.getSnapshot().revalidating, true, mode);
		response.resolve({
			facts: [fact("a", {})],
			memberships: [
				{
					resource: "tasks",
					identities: ["a"],
					complete: true,
					basis: ["public"],
				},
			],
		});
		await tick();
		assert.deepEqual(status.getSnapshot(), idle);
	}
});

test("all read-status subscribers receive changes and canceling the last imperative read removes demand", async (t) => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						run: () => response.promise,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const status = runtime.watchReadStatus(list());
	const seen: boolean[][] = [[], []];
	t.after(status.subscribe(() => seen[0]?.push(status.getSnapshot().pending)));
	t.after(status.subscribe(() => seen[1]?.push(status.getSnapshot().pending)));
	const controller = new AbortController();
	const read = runtime.read(one(), { signal: controller.signal });
	await tick();
	assert.equal(status.getSnapshot().pending, true);
	controller.abort();
	await assert.rejects(read);
	assert.deepEqual(status.getSnapshot(), idle);
	assert.deepEqual(seen, [
		[true, false],
		[true, false],
	]);
	response.resolve({ facts: [fact("a", { notes: "Done" })] });
	await tick();
});

test("a field's rejected prerequisite does not become an unrelated selected field's issue", async (t) => {
	const runtime = createRuntime({
		access: [{ scope: "secret", state: "denied" }],
		resources: [
			{
				name: "tasks",
				fieldDependencies: {
					notes: (identity) => [
						query({
							resource: "details",
							mode: "one",
							identity,
							select: ["text"],
						}),
					],
				},
			},
			{ name: "details", fieldAccess: { text: "secret" } },
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", {})] });
	const descriptor = one("a", ["title", "notes"]);
	const view = runtime.watch(descriptor);
	t.after(view.subscribe(() => undefined));
	await runtime.read(descriptor);
	assert.deepEqual(
		runtime
			.watchReadStatus(one("a", ["title"]))
			.getSnapshot()
			.issues.map((issue) => issue.kind),
		["unsupported"],
	);
	assert.deepEqual(
		runtime
			.watchReadStatus(one("a", ["notes"]))
			.getSnapshot()
			.issues.map((issue) => issue.kind),
		["access"],
	);
});

test("a classified access acquisition failure remains explicitly retryable without retiring permission", async (t) => {
	let fail = true;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							if (fail)
								throw new AcquisitionError({
									kind: "access",
									message: "Verify credentials before trying again",
								});
							return { facts: [fact("a", { notes: "Available" })] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const view = runtime.watch(one());
	t.after(view.subscribe(() => undefined));
	const status = runtime.watchReadStatus(one());
	await runtime.read(one());
	assert.equal(status.getSnapshot().issues[0]?.kind, "access");
	assert.equal(status.getSnapshot().canRetry, true);
	fail = false;
	await status.retry();
	assert.deepEqual(status.getSnapshot(), idle);
});
