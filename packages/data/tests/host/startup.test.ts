// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserClient } from "../../src/client.js";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import { createSharedHost } from "../../src/worker.js";
import {
	channel,
	compatibility,
	Locks,
	tick,
	until,
} from "../support/browser-client.js";

const selected = query({
	resource: "things",
	mode: "one",
	identity: "a",
	select: ["name"],
});

test("slow owner startup keeps the connection pending and accepts late readiness", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const startup = deferred<void>();
	const restoration = deferred<void>();
	const persistence = new MemoryPersistence();
	const load = persistence.load.bind(persistence);
	persistence.load = async () => {
		await restoration.promise;
		return load();
	};
	const runtime = createRuntime({
		persistence,
		resources: [
			{
				name: "things",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name"],
						async run() {
							return {
								facts: [
									{
										resource: "things",
										identity: "a",
										presence: "present",
										values: { name: "Ready" },
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
	const owner = createSharedHost({
		compatibility,
		lockName: "owner",
		locks: new Locks(),
		async create() {
			await startup.promise;
			return { client: runtime, dispose() {} };
		},
	});
	const { client, messages } = channel(t, (port) => {
		void owner.then((attach) => attach(port));
	});
	const view = client.watch(selected);
	view.subscribe(() => undefined);
	let settled = false;
	const read = client.read(selected).finally(() => {
		settled = true;
	});
	const canceled = new AbortController();
	const canceledRead = client.read(selected, { signal: canceled.signal });
	const aborted = assert.rejects(canceledRead, { name: "AbortError" });
	await tick();
	t.mock.timers.tick(120_000);
	await tick();
	assert.deepEqual(client.connectionSnapshot(), {
		phase: "connecting",
		updateAvailable: false,
	});
	assert.equal(settled, false);
	assert.equal(view.getSnapshot().issues.length, 0);
	canceled.abort();
	await aborted;
	assert.equal(client.connectionSnapshot().phase, "connecting");
	startup.resolve();
	await tick();
	t.mock.timers.tick(120_000);
	await tick();
	assert.equal(client.connectionSnapshot().phase, "connecting");
	assert.equal(settled, false);
	restoration.resolve();
	const result = await read;
	await until(() => view.getSnapshot().rows[0]?.data.name === "Ready");
	assert.equal(result.rows[0]?.data.name, "Ready");
	assert.equal(client.connectionSnapshot().phase, "ready");
	assert.deepEqual(messages, []);
});

test("a real worker startup error settles readers even after a long connection wait", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const pair = new MessageChannel();
	const worker = new EventTarget();
	const client = new BrowserClient(pair.port1, compatibility, {
		worker: worker as SharedWorker,
	});
	t.after(() => {
		client.close();
		pair.port2.close();
	});
	const read = client.read(selected);
	const rejected = assert.rejects(read, /shared worker could not run/);
	t.mock.timers.tick(120_000);
	assert.equal(client.connectionSnapshot().phase, "connecting");
	worker.dispatchEvent(new Event("error"));
	await rejected;
	assert.equal(client.connectionSnapshot().phase, "failed");
	pair.port2.postMessage({ type: "ready", compatibility });
	await tick();
	assert.equal(client.connectionSnapshot().phase, "failed");
});

test("initial stale knowledge reaches nested consumers before queued acquisition is admitted", async (t) => {
	const identities = ["a", "b", "c", "d", "e"];
	const continuity = { channel: "events" };
	const facts = identities.map((identity) => ({
		resource: "things",
		identity,
		presence: "present" as const,
		values: { name: identity, description: "Known description" },
		basis: ["public"],
		liveness: continuity,
	}));
	const membership = {
		resource: "things",
		identities,
		complete: true,
		basis: ["public"],
		liveness: continuity,
	};
	const calls: string[] = [];
	const response = deferred<{
		facts: typeof facts;
		memberships: (typeof membership)[];
	}>();
	const runtime = createRuntime({
		resources: [
			{
				name: "things",
				sources: [
					{
						key: "names",
						mode: "list",
						membership: true,
						fields: ["name"],
						async run() {
							calls.push("names");
							return response.promise;
						},
					},
					{
						key: "all",
						mode: "list",
						membership: true,
						fields: ["name", "description"],
						async run() {
							calls.push("all");
							return response.promise;
						},
					},
					{
						key: "one",
						mode: "one",
						fields: ["name", "description"],
						async run(request) {
							calls.push(String(request.identity));
							return response.promise;
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	await runtime.ready;
	runtime.setContinuity(continuity, "live");
	runtime.observe({ facts, memberships: [membership] });
	runtime.setContinuity(continuity, "interrupted");
	const attach = await createSharedHost({
		compatibility,
		lockName: "owner",
		locks: new Locks(),
		create: async () => ({ client: runtime, dispose() {} }),
	});
	const { client } = channel(t, attach);
	const list = client.watch(
		query({ resource: "things", mode: "list", select: ["name"] }),
	);
	let mounted = false;
	const stops: (() => void)[] = [];
	stops.push(
		list.subscribe(() => {
			if (mounted || !list.getSnapshot().rows.length) return;
			mounted = true;
			assert.equal(client.connectionSnapshot().phase, "connecting");
			for (const identity of identities)
				stops.push(
					client
						.watch(
							query({
								resource: "things",
								mode: "one",
								identity,
								select: ["description"],
							}),
						)
						.subscribe(() => undefined),
				);
		}),
	);
	t.after(() => {
		for (const stop of stops) stop();
	});
	await until(() => calls.length > 0);
	assert.equal(mounted, true);
	assert.equal(list.getSnapshot().rows.length, 5);
	assert.deepEqual(calls, ["all"]);
	response.resolve({ facts, memberships: [membership] });
	await until(() => list.getSnapshot().settled);
	assert.deepEqual(calls, ["all"]);
});
