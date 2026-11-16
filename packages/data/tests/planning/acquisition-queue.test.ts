// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query, stableKey } from "../../src/descriptors.js";
import { emptyResult } from "../../src/protocol.js";
import { AcquisitionQueue } from "../../src/runtime/acquisition.js";
import type { QueryState } from "../../src/runtime/state.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type {
	AcquisitionSource,
	ObservationBatch,
	ResourceContext,
} from "../../src/types.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100 && !predicate(); i++) await tick();
	assert.ok(predicate());
}

test("a new field demand replans queued acquisition before either consumer is marked attempted", async (t) => {
	const held = deferred<ObservationBatch>();
	const executed: string[][] = [];
	const executionOrder: string[] = [];
	const runtime = createRuntime({
		maxConcurrent: 1,
		resources: [
			{
				name: "blocker",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name"],
						membership: true,
						run: async () => held.promise,
					},
				],
			},
			{
				name: "widgets",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "description"],
						membership: true,
						select: true,
						run: async (request) => {
							const fields = [...request.fields].sort();
							executionOrder.push("widgets");
							executed.push(fields);
							return {
								facts: [
									{
										resource: "widgets",
										identity: "one",
										presence: "present",
										values: Object.fromEntries(
											fields.map((field) => [field, field]),
										),
										basis: ["public"],
									},
								],
								memberships: [
									{
										resource: "widgets",
										identities: ["one"],
										complete: true,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
			},
			{
				name: "later",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name"],
						membership: true,
						run: async () => {
							executionOrder.push("later");
							return {
								memberships: [
									{
										resource: "later",
										identities: [],
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
	const blocker = runtime.watch(
		query({ resource: "blocker", mode: "list", select: ["name"] }),
	);
	const stopBlocker = blocker.subscribe(() => undefined);
	t.after(stopBlocker);
	await until(() => blocker.getSnapshot().fetching);
	const first = runtime.watch(
		query({ resource: "widgets", mode: "list", select: ["name"] }),
	);
	const stopFirst = first.subscribe(() => undefined);
	t.after(stopFirst);
	await until(() => first.getSnapshot().fetching);
	const later = runtime.watch(
		query({ resource: "later", mode: "list", select: ["name"] }),
	);
	const stopLater = later.subscribe(() => undefined);
	t.after(stopLater);
	await until(() => later.getSnapshot().fetching);
	const second = runtime.watch(
		query({ resource: "widgets", mode: "list", select: ["description"] }),
	);
	const stopSecond = second.subscribe(() => undefined);
	t.after(stopSecond);
	await until(() => second.getSnapshot().fetching);
	held.resolve({
		memberships: [
			{
				resource: "blocker",
				identities: [],
				complete: true,
				basis: ["public"],
			},
		],
	});
	await until(
		() =>
			first.getSnapshot().settled &&
			second.getSnapshot().settled &&
			later.getSnapshot().settled,
	);
	assert.deepEqual(executed, [["description", "name"]]);
	assert.deepEqual(executionOrder, ["widgets", "later"]);
	assert.equal(first.getSnapshot().rows[0]?.complete, true);
	assert.equal(second.getSnapshot().rows[0]?.data.description, "description");
	assert.equal(second.getSnapshot().rows[0]?.complete, true);
});

test("independent reads use browser concurrency by default and still share duplicate demand", async (t) => {
	const gate = deferred<void>();
	const started: unknown[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name"],
						async run(request) {
							started.push(request.identity);
							await gate.promise;
							return {
								facts: [
									{
										resource: "tasks",
										identity: request.identity,
										presence: "present",
										values: { name: request.identity },
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
	const descriptions = Array.from({ length: 8 }, (_, index) =>
		query({
			resource: "tasks",
			mode: "one",
			identity: String(index),
			select: ["name"],
		}),
	);
	const reads = [...descriptions, ...descriptions.slice(0, 1)].map(
		(description) => runtime.read(description),
	);
	await until(() => started.length === 8);
	assert.equal(started.length, 8);
	gate.resolve();
	assert.ok(
		(await Promise.all(reads)).every((result) => result.rows[0]?.complete),
	);
});

test("native fetch hints follow missing and stale demand and promote shared work", async (t) => {
	const hints: [unknown, unknown][] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name", "notes"],
						async run(request, context) {
							hints.push([request.identity, context.fetchPriority]);
							return {
								facts: [
									{
										resource: "tasks",
										identity: request.identity,
										presence: "present",
										values: { name: "Fresh", notes: "Fresh notes" },
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
	runtime.observe({
		facts: ["stale", "shared"].map((identity) => ({
			resource: "tasks",
			identity,
			presence: "present",
			values: { name: "Cached" },
			basis: ["public"],
			liveness: { channel: "tasks" },
		})),
	});
	runtime.setContinuity({ channel: "tasks" }, "interrupted");
	const read = (identity: string, select: readonly string[]) =>
		runtime.read(query({ resource: "tasks", mode: "one", identity, select }));
	await Promise.all([
		read("stale", ["name"]),
		read("missing", ["name"]),
		read("shared", ["name"]),
		read("shared", ["notes"]),
	]);
	assert.equal(hints.length, 3);
	assert.equal(hints.find(([id]) => id === "stale")?.[1], "low");
	assert.equal(hints.find(([id]) => id === "missing")?.[1], "high");
	assert.equal(hints.find(([id]) => id === "shared")?.[1], "high");
});

const taskQuery = (identity: string, select: readonly string[] = ["name"]) =>
	query({ resource: "tasks", mode: "one", identity, select });
const taskList = query({ resource: "tasks", mode: "list", select: ["name"] });
const taskBatch = (
	identity: unknown,
	values: Record<string, unknown>,
): ObservationBatch => ({
	facts: [
		{
			resource: "tasks",
			identity,
			presence: "present",
			values,
			basis: ["public"],
		},
	],
});
const tasksBatch = (values = { name: "Current" }): ObservationBatch => ({
	...taskBatch("one", values),
	memberships: [
		{
			resource: "tasks",
			identities: ["one"],
			complete: true,
			basis: ["public"],
		},
	],
});
function supersessionSources(
	detail: AcquisitionSource["run"],
	collection: AcquisitionSource["run"],
	fields = ["name"],
): AcquisitionSource[] {
	return [
		{ key: "detail", mode: "one", fields, cost: 1, run: detail },
		{
			key: "collection",
			mode: "list",
			fields: ["name"],
			membership: true,
			cost: 3,
			run: collection,
		},
	];
}

test("a dispatched collection cancels a covered detail and ignores its late response", {
	timeout: 5000,
}, async (t) => {
	const detail = deferred<ObservationBatch>();
	const collection = deferred<ObservationBatch>();
	let original: ResourceContext | undefined;
	let collectionStarted = false;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: supersessionSources(
					async (_request, context) => {
						original = context;
						return detail.promise;
					},
					async () => {
						collectionStarted = true;
						return collection.promise;
					},
				),
			},
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(taskQuery("one"));
	await until(() => original !== undefined);
	const all = runtime.read(taskList);
	await until(() => collectionStarted && original?.signal.aborted === true);
	assert.equal(runtime.peekQuery(taskQuery("one"))?.issues.length, 0);
	original?.observe(taskBatch("one", { name: "Canceled publication" }));
	assert.equal(runtime.peekQuery(taskQuery("one"))?.rows.length, 0);
	collection.resolve(tasksBatch());
	assert.equal((await first).rows[0]?.data.name, "Current");
	assert.equal((await all).confirmed.complete, true);
	detail.resolve(taskBatch("one", { name: "Late old result" }));
	await tick();
	assert.equal(
		runtime.peekQuery(taskQuery("one"))?.rows[0]?.data.name,
		"Current",
	);
});

test("a collection cannot cancel a detail still supplying a representation token to another consumer", {
	timeout: 5000,
}, async (t) => {
	const detail = deferred<ObservationBatch>();
	const collection = deferred<ObservationBatch>();
	let original: ResourceContext | undefined;
	let collectionStarted = false;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: supersessionSources(async (_request, context) => {
					original = context;
					return detail.promise;
				}, async () => {
					collectionStarted = true;
					return collection.promise;
				}, ["name", "detailETag"]),
			},
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(taskQuery("one"));
	await until(() => original !== undefined);
	const token = runtime.read(taskQuery("one", ["detailETag"]));
	const all = runtime.read(taskList);
	await until(() => collectionStarted);
	assert.equal(original?.signal.aborted, false);
	collection.resolve(tasksBatch());
	await all;
	assert.equal(original?.signal.aborted, false);
	detail.resolve(taskBatch("one", { name: "Detail", detailETag: '"one"' }));
	assert.equal((await token).rows[0]?.data.detailETag, '"one"');
	await first;
});

for (const outcome of ["failed", "partial"] as const) {
	test(`a ${outcome} replacement retries canceled detail without late cleanup deleting the retry`, {
		timeout: 5000,
	}, async (t) => {
		const old = deferred<ObservationBatch>();
		const retry = deferred<ObservationBatch>();
		const collection = deferred<ObservationBatch>();
		const details: ResourceContext[] = [];
		let collectionStarted = false;
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					sources: supersessionSources(
						async (_request, context) => {
							details.push(context);
							return details.length === 1 ? old.promise : retry.promise;
						},
						async () => {
							collectionStarted = true;
							return collection.promise;
						},
					),
				},
			],
		});
		t.after(() => runtime.close());
		const first = runtime.read(taskQuery("one"));
		await until(() => details.length === 1);
		const all = runtime.read(taskList);
		await until(() => collectionStarted && details[0]?.signal.aborted === true);
		if (outcome === "failed")
			collection.reject(new Error("Collection unavailable"));
		else collection.resolve({ memberships: tasksBatch().memberships });
		await until(() => details.length === 2);
		old.resolve(taskBatch("one", { name: "Canceled" }));
		await tick();
		assert.equal(runtime.peekQuery(taskQuery("one"))?.fetching, true);
		assert.equal(
			runtime.peekQuery(taskQuery("one"))?.rows[0]?.data.name,
			undefined,
		);
		const same = runtime.read(taskQuery("one"));
		await tick();
		assert.equal(details.length, 2);
		retry.resolve(taskBatch("one", { name: "Recovered" }));
		assert.equal((await first).rows[0]?.data.name, "Recovered");
		assert.equal((await same).rows[0]?.data.name, "Recovered");
		await all;
		assert.equal(details[1]?.signal.aborted, false);
	});
}

test("a replacement queued behind a host limit does not cancel its running predecessor", {
	timeout: 5000,
}, async (t) => {
	const detail = deferred<ObservationBatch>();
	let original: ResourceContext | undefined;
	let collectionStarted = false;
	const runtime = createRuntime({
		maxConcurrent: 1,
		resources: [
			{
				name: "tasks",
				sources: supersessionSources(
					async (_request, context) => {
						original = context;
						return detail.promise;
					},
					async () => {
						collectionStarted = true;
						return tasksBatch();
					},
				),
			},
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(taskQuery("one"));
	await until(() => original !== undefined);
	const all = runtime.read(taskList);
	await tick();
	assert.equal(collectionStarted, false);
	assert.equal(original?.signal.aborted, false);
	detail.resolve(taskBatch("one", { name: "Current" }));
	await Promise.all([first, all]);
	assert.equal(collectionStarted, true);
});

for (const failure of [
	"availability changed",
	"synchronous failure",
] as const) {
	test(`a replacement with ${failure} before dispatch does not cancel its predecessor`, {
		timeout: 5000,
	}, async (t) => {
		const detail = deferred<ObservationBatch>();
		let original: ResourceContext | undefined;
		let detailCalls = 0;
		let collectionCalls = 0;
		let available = true;
		const sources = supersessionSources(
			async (_request, context) => {
				detailCalls++;
				original = context;
				return detail.promise;
			},
			() => {
				collectionCalls++;
				throw new Error("Source failed before dispatch");
			},
		);
		const collection = sources[1];
		assert.ok(collection);
		collection.available = () => available;
		const runtime = createRuntime({ resources: [{ name: "tasks", sources }] });
		t.after(() => runtime.close());
		runtime.subscribe(() => {
			if (
				failure === "availability changed" &&
				runtime.peekQuery(taskList)?.fetching
			)
				available = false;
		});
		const first = runtime.read(taskQuery("one"));
		await until(() => original !== undefined);
		const all = runtime.read(taskList);
		await until(() => Boolean(runtime.peekQuery(taskList)?.issues.length));
		assert.equal(collectionCalls, failure === "availability changed" ? 0 : 1);
		assert.equal(original?.signal.aborted, false);
		assert.equal(detailCalls, 1);
		detail.resolve(taskBatch("one", { name: "Current" }));
		assert.equal((await first).rows[0]?.data.name, "Current");
		await all;
	});
}

for (const change of ["authority", "evidence generation"] as const) {
	test(`settled demand resumes when ${change} advances without a query version change`, async (t) => {
		const descriptor = taskQuery("one");
		const state: QueryState = {
			key: stableKey(descriptor),
			descriptor,
			listeners: new Set(),
			snapshot: emptyResult(),
			version: 0,
			attempted: -1,
			forced: -1,
			fetching: 0,
			users: 1,
			demands: 1,
			waiters: 0,
			issues: [],
			active: true,
		};
		const held = deferred<ObservationBatch>();
		const blocked: QueryState = {
			...state,
			key: stableKey(taskQuery("two")),
			descriptor: taskQuery("two"),
			listeners: new Set(),
			issues: [],
		};
		let pending = true;
		let authority = "first";
		let generation = 0;
		let available = false;
		let missing = true;
		let calls = 0;
		const basis = (scope: string) => ({ scope, epoch: "test", generation: 1 });
		const queue = new AcquisitionQueue(
			{
				queries: new Map([
					[state.key, state],
					[blocked.key, blocked],
				]),
				needs: (current) => (current === blocked ? pending : missing),
				requirements: (requested) =>
					(requested.identity === "two" ? pending : missing)
						? [
								{
									kind: "field",
									resource: "tasks",
									identity: requested.identity,
									field: "name",
									query: requested,
									generation: requested.identity === "two" ? 0 : generation,
								},
							]
						: [],
				population: () => ({ kind: "known", count: 1, evidence: "current" }),
				matches: () => true,
				definition: () => ({
					name: "tasks",
					sources: [
						{
							key: "detail",
							mode: "one",
							fields: ["name"],
							available: (request) => request.identity === "two" || available,
							async run(request) {
								if (request.identity === "two") return held.promise;
								calls++;
								return taskBatch("one", { name: "Current" });
							},
						},
					],
				}),
				context: (signal) => ({
					signal,
					accessContext: "test",
					acquisitionFence: "test",
					authorityFence: authority,
					get: () => undefined,
					disclosure: () => basis("public"),
					records: () => [],
					memberships: () => [],
					relationship: () => undefined,
					membership: () => undefined,
					observe: (batch) => {
						if (batch.facts?.[0]?.identity === "two") pending = false;
						else missing = false;
					},
					grant: () => {},
					basis,
					proof: () => basis("public"),
					access: () => "allowed",
				}),
				errorGuard: () => () => true,
				batch: (work) => work(),
				changed: () => {},
			},
			undefined,
		);
		t.after(() => {
			queue.close();
			held.resolve(taskBatch("two", { name: "Later" }));
		});
		queue.schedule();
		await until(
			() => state.attempted === state.version && blocked.fetching > 0,
		);
		assert.equal(state.issues[0]?.kind, "unsupported");
		available = true;
		if (change === "authority") authority = "second";
		else generation++;
		queue.schedule();
		await until(
			() => calls === 1 && state.fetching === 0 && state.issues.length === 0,
		);
		assert.equal(state.version, 0);
		assert.ok(blocked.fetching > 0);
		assert.equal(missing, false);
		queue.schedule();
		await tick();
		assert.equal(calls, 1);
	});
}
