// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";

import { fact, list, options, resource, tick } from "../support/scenario.js";

test("partial selected fields remain visible and unknown predicates stay separate", () => {
	const runtime = createRuntime(options());
	runtime.observe({
		facts: [
			fact("a", { name: "A" }),
			fact("b", { name: "B", status: "running" }),
		],
		memberships: [
			{
				resource: "things",
				identities: ["a", "b"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const all = runtime.watch(list);
	assert.equal(all.getSnapshot().rows.length, 2);
	assert.equal(all.getSnapshot().rows[0]?.complete, false);
	const filtered = runtime.watch({ ...list, where: { status: "running" } });
	assert.equal(filtered.getSnapshot().rows.length, 1);
	assert.equal(filtered.getSnapshot().unresolved.length, 1);
	assert.equal(filtered.getSnapshot().confirmed.complete, false);
	runtime.close();
});

test("one finite acquisition does not loop when coverage or fields remain unavailable", async () => {
	let calls = 0;
	const runtime = createRuntime(
		options(
			resource({
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "status"],
						membership: true,
						run: async () => {
							calls++;
							return { facts: [fact("a", { name: "A" })] };
						},
					},
				],
			}),
		),
	);
	const result = await runtime.read(list);
	assert.equal(result.settled, true);
	assert.equal(result.confirmed.complete, false);
	await tick();
	await tick();
	assert.equal(calls, 1);
	await runtime.read(list);
	assert.equal(calls, 1);
	runtime.close();
});

test("observations are one coherent publication across query handles", () => {
	const runtime = createRuntime(options());
	const a = runtime.watch(
		query({ resource: "things", mode: "one", identity: "a", select: ["name"] }),
	);
	const b = runtime.watch(
		query({ resource: "things", mode: "one", identity: "b", select: ["name"] }),
	);
	const seen: unknown[] = [];
	a.subscribe(() =>
		seen.push([
			a.getSnapshot().rows[0]?.data.name,
			b.getSnapshot().rows[0]?.data.name,
		]),
	);
	runtime.observe({
		facts: [fact("a", { name: "A" }), fact("b", { name: "B" })],
	});
	assert.deepEqual(seen, [["A", "B"]]);
	runtime.close();
});

test("membership evidence renders known members before selected details arrive", () => {
	const runtime = createRuntime(options());
	runtime.observe({
		memberships: [
			{
				resource: "things",
				where: { status: "running" },
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const watch = runtime.watch({ ...list, where: { status: "running" } });
	assert.equal(watch.getSnapshot().rows.length, 1);
	assert.equal(watch.getSnapshot().rows[0]?.complete, false);
	assert.equal(watch.getSnapshot().unresolved.length, 0);
	assert.equal(watch.getSnapshot().confirmed.total, 1);
	assert.equal(watch.getSnapshot().empty, false);
	runtime.close();
});

test("retry preserves complete knowledge and waits only for remaining stale acquisition", async () => {
	const response = deferred<ObservationBatch>();
	let calls = 0;
	const runtime = createRuntime(
		options(
			resource({
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "status"],
						membership: true,
						run: async () => {
							calls++;
							return response.promise;
						},
					},
				],
			}),
		),
	);
	runtime.observe({
		facts: [fact("a", { name: "A", status: "running" })],
		memberships: [
			{
				resource: "things",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const watch = runtime.watch(list);
	assert.equal((await watch.retry()).rows[0]?.data.name, "A");
	assert.equal(calls, 0);
	runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "status" }],
	});
	const retry = watch.retry();
	let finished = false;
	void retry.then(() => {
		finished = true;
	});
	await tick();
	assert.equal(calls, 1);
	assert.equal(finished, false);
	response.resolve({ facts: [fact("a", { name: "B", status: "stopped" })] });
	const result = await retry;
	assert.equal(result.rows[0]?.data.name, "B");
	runtime.close();
});

test("bounded scheduler deduplicates identical demand and isolates a rejected task", async () => {
	const gate = deferred<void>();
	let concurrent = 0,
		peak = 0,
		calls = 0;
	const runtime = createRuntime({
		...options(
			resource({
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name"],
						run: async (descriptor) => {
							calls++;
							concurrent++;
							peak = Math.max(peak, concurrent);
							await gate.promise;
							concurrent--;
							if (descriptor.identity === "bad") throw new Error("Unavailable");
							return {
								facts: [fact(String(descriptor.identity), { name: "value" })],
							};
						},
					},
				],
			}),
		),
		maxConcurrent: 2,
	});
	const descriptors = ["a", "a", "bad", "b"].map((identity) =>
		query({ resource: "things", mode: "one", identity, select: ["name"] }),
	);
	const reads = descriptors.map((descriptor) => runtime.read(descriptor));
	await tick();
	assert.equal(peak, 2);
	gate.resolve();
	const results = await Promise.all(reads);
	assert.equal(calls, 3);
	assert.equal(results[2]?.issues[0]?.kind, "read");
	assert.equal(results[3]?.rows[0]?.data.name, "value");
	runtime.close();
});

test("five thousand rows preserve unrelated selected snapshots during a localized update", () => {
	const runtime = createRuntime(options());
	const identities = Array.from({ length: 5000 }, (_, index) => String(index));
	runtime.observe({
		facts: identities.map((identity) =>
			fact(identity, {
				name: `Thing ${identity}`,
				status: "ready",
				counter: 0,
			}),
		),
		memberships: [
			{ resource: "things", identities, complete: true, basis: ["read"] },
		],
	});
	const watches = identities
		.slice(0, 100)
		.map((identity) =>
			runtime.watch(
				query({ resource: "things", mode: "one", identity, select: ["name"] }),
			),
		);
	let notifications = 0;
	for (const watch of watches)
		watch.subscribe(() => {
			notifications++;
		});
	const untouchedWatch = watches[50];
	assert.ok(untouchedWatch);
	const untouched = untouchedWatch.getSnapshot();
	runtime.observe({ facts: [fact("0", { counter: 1 })] });
	assert.equal(notifications, 0);
	runtime.observe({ facts: [fact("0", { name: "Changed" })] });
	assert.equal(notifications, 1);
	assert.equal(untouchedWatch.getSnapshot(), untouched);
	assert.equal(runtime.watch(list).getSnapshot().confirmed.total, 5000);
	runtime.close();
});

test("Strict Mode subscription replay reattaches an evicted handle without pinning abandoned renders", async () => {
	let reads = 0;
	const runtime = createRuntime({
		...options(
			resource({
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name"],
						run: async () => {
							reads++;
						},
					},
				],
			}),
		),
		maxInactiveQueries: 0,
	});
	runtime.observe({ facts: [fact("a", { name: "A" })] });
	const descriptor = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["name"],
	});
	const watch = runtime.watch(descriptor);
	const first = watch.subscribe(() => undefined);
	first();
	runtime.observe({ facts: [fact("a", { name: "B" })] });
	let notifications = 0;
	const second = watch.subscribe(() => {
		notifications++;
	});
	assert.equal(watch.getSnapshot().rows[0]?.data.name, "B");
	for (let index = 0; index < 100; index++)
		runtime.watch(
			query({
				resource: "things",
				mode: "one",
				identity: `abandoned-${index}`,
				select: ["name"],
			}),
		);
	runtime.observe({ facts: [fact("a", { name: "C" })] });
	await tick();
	assert.equal(notifications, 1);
	assert.equal(reads, 0);
	second();
	watch.dispose();
	runtime.close();
});

test("inactive knowledge eviction withdraws completeness without evicting active demand", () => {
	const runtime = createRuntime({ ...options(), maxInactiveRecords: 2 });
	const active = runtime.watch(
		query({ resource: "things", mode: "one", identity: "a", select: ["name"] }),
	);
	const unsubscribe = active.subscribe(() => undefined);
	runtime.observe({
		facts: [
			fact("a", { name: "A" }),
			fact("b", { name: "B" }),
			fact("c", { name: "C" }),
		],
		memberships: [
			{
				resource: "things",
				identities: ["a", "b", "c"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	assert.equal(active.getSnapshot().rows[0]?.data.name, "A");
	unsubscribe();
	const all = runtime.watch(list).getSnapshot();
	assert.equal(all.rows.length, 2);
	assert.equal(all.confirmed.complete, false);
	assert.equal(all.confirmed.total, undefined);
	assert.equal(active.getSnapshot().exists, undefined);
	runtime.close();
});

test("leaving queued demand does not count as an attempt and returning does not retry dispatched failures", async () => {
	const running = deferred<ObservationBatch>();
	const calls: unknown[] = [];
	const runtime = createRuntime({
		...options(
			resource({
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name"],
						run: async (descriptor) => {
							calls.push(descriptor.identity);
							if (descriptor.identity === "a") return running.promise;
							throw new Error("Temporarily unavailable");
						},
					},
				],
			}),
		),
		maxConcurrent: 1,
	});
	const a = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["name"],
	});
	const b = query({
		resource: "things",
		mode: "one",
		identity: "b",
		select: ["name"],
	});
	const first = runtime.read(a);
	const queued = runtime.watch(b);
	const leave = queued.subscribe(() => undefined);
	await tick();
	assert.deepEqual(calls, ["a"]);
	assert.equal(queued.getSnapshot().fetching, true);
	leave();
	running.resolve({ facts: [fact("a", { name: "A" })] });
	await first;
	await tick();
	assert.deepEqual(calls, ["a"]);
	assert.equal(queued.getSnapshot().fetching, false);
	assert.equal(queued.getSnapshot().settled, false);
	const returned = await runtime.read(b);
	assert.deepEqual(calls, ["a", "b"]);
	assert.equal(returned.issues[0]?.message, "Temporarily unavailable");
	await runtime.read(b);
	assert.deepEqual(calls, ["a", "b"]);
	await queued.retry();
	assert.deepEqual(calls, ["a", "b", "b"]);
	queued.dispose();
	runtime.close();
});

test("completed acquisitions respect inactive retention without dropping imperative read results", async () => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime({
		...options(
			resource({
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name"],
						run: async () => response.promise,
					},
				],
			}),
		),
		maxInactiveQueries: 0,
	});
	const a = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["name"],
	});
	const b = query({
		resource: "things",
		mode: "one",
		identity: "b",
		select: ["name"],
	});
	const view = runtime.watch(a);
	const stop = view.subscribe(() => undefined);
	const read = runtime.read(b);
	await tick();
	assert.equal(view.getSnapshot().fetching, true);
	stop();
	view.dispose();
	response.resolve({
		facts: [fact("a", { name: "A" }), fact("b", { name: "B" })],
	});
	assert.equal((await read).rows[0]?.data.name, "B");
	await tick();
	assert.equal(runtime.peekQuery(a), undefined);
	assert.equal(runtime.peekQuery(b), undefined);
	runtime.close();
});
