// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserQueries } from "../../src/client-queries.js";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { fact, options, resource } from "../support/scenario.js";

test("inactive projections do no work until read and immediately return current knowledge", (t) => {
	const matches = new Map<unknown, number>();
	const definition = resource({
		matches: (values, where) => {
			matches.set(where.status, (matches.get(where.status) ?? 0) + 1);
			return values.status === where.status;
		},
	});
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			fact("a", { name: "A", status: "Running" }),
			fact("b", { name: "B", status: "Stopped" }),
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
	const sent: unknown[] = [];
	const client = new BrowserQueries(
		[definition],
		{
			send: (message) => sent.push(message),
			retry: async () => {
				throw new Error("Unexpected acquisition");
			},
		},
		16,
	);
	const sync = (accessChanged = false) =>
		client.apply(
			runtime.readModelSnapshot(),
			runtime.accessSnapshot(),
			[],
			[],
			false,
			accessChanged,
		);
	sync();
	const running = client.watch(
		query({
			resource: "things",
			mode: "list",
			select: ["name", "status"],
			where: { status: "Running" },
		}),
	);
	const stoppedQuery = query({
		resource: "things",
		mode: "list",
		select: ["name", "status"],
		where: { status: "Stopped" },
	});
	const stopped = client.watch(stoppedQuery);
	let notifications = 0;
	running.subscribe(() => {
		notifications++;
	});
	stopped.subscribe(() => {
		throw new Error("Inactive listener notified");
	})();
	assert.equal(stopped.getSnapshot().rows[0]?.data.name, "B");
	matches.clear();
	sent.length = 0;
	runtime.observe({
		facts: [fact("a", { name: "Updated A" }), fact("b", { name: "Updated B" })],
	});
	for (const notify of sync()) notify();
	assert.ok((matches.get("Running") ?? 0) > 0);
	assert.equal(
		matches.get("Stopped") ?? 0,
		0,
		"inactive filters were not projected during publication",
	);
	assert.equal(notifications, 1);
	assert.equal(running.getSnapshot().rows[0]?.data.name, "Updated A");
	const current = stopped.getSnapshot();
	assert.equal(current.rows[0]?.data.name, "Updated B");
	assert.equal(current.fetching, false);
	assert.ok((matches.get("Stopped") ?? 0) > 0);
	const count = matches.get("Stopped");
	assert.equal(stopped.getSnapshot(), current);
	assert.equal(client.watch(stoppedQuery).getSnapshot(), current);
	assert.equal(
		matches.get("Stopped"),
		count,
		"unchanged snapshots keep their identity without repeat projection",
	);
	assert.deepEqual(
		sent,
		[],
		"reading inactive knowledge creates no acquisition demand",
	);

	runtime.revoke("read");
	sync(true);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	sync(true);
	assert.equal(
		stopped.getSnapshot().rows.length,
		0,
		"deferred reads cannot redisclose revoked facts after regrant",
	);
	assert.equal(running.getSnapshot().rows.length, 0);
	running.dispose();
	stopped.dispose();
});

test("incremental publication is atomic and a dormant filter catches up after a long gap", (t) => {
	const definition = resource();
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			fact("a", { name: "A", status: "Running" }),
			fact("b", { name: "B", status: "Stopped" }),
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
	const client = new BrowserQueries(
		[definition],
		{
			send: () => undefined,
			retry: async () => {
				throw new Error("Unexpected acquisition");
			},
		},
		16,
	);
	const sync = () =>
		client.apply(
			runtime.readModelSnapshot(),
			runtime.accessSnapshot(),
			[],
			[],
			false,
			false,
		);
	sync();
	const running = client.watch(
		query({
			resource: "things",
			mode: "list",
			select: ["name"],
			where: { status: "Running" },
		}),
	);
	const stopped = client.watch(
		query({
			resource: "things",
			mode: "list",
			select: ["name"],
			where: { status: "Stopped" },
		}),
	);
	let notifications = 0;
	const coherent = () => {
		notifications++;
		assert.deepEqual(running.getSnapshot().rows, []);
		assert.deepEqual(
			stopped.getSnapshot().rows.map((row) => row.data.name),
			["A", "B"],
		);
	};
	const stopRunning = running.subscribe(coherent);
	const stopStopped = stopped.subscribe(coherent);
	runtime.observe({ facts: [fact("a", { status: "Stopped" })] });
	for (const notify of sync()) notify();
	assert.equal(notifications, 2);
	stopRunning();
	stopStopped();
	const previous = stopped.getSnapshot();
	for (let index = 0; index < 80; index++) {
		runtime.observe({ facts: [fact("b", { name: `B ${index}` })] });
		sync();
	}
	assert.notEqual(stopped.getSnapshot(), previous);
	assert.deepEqual(
		stopped.getSnapshot().rows.map((row) => row.data.name),
		["A", "B 79"],
	);
	assert.equal(stopped.getSnapshot().fetching, false);
	running.dispose();
	stopped.dispose();
});

test("a semantically unchanged reset is compared once without repeatedly walking retained rows", (t) => {
	const definition = resource();
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	const identities = Array.from({ length: 64 }, (_, index) => String(index));
	runtime.observe({
		facts: [
			...identities.map((identity) =>
				fact(identity, { name: `Task ${identity}`, status: "Running" }),
			),
			fact("other", { name: "Other", status: "Stopped" }),
		],
		memberships: [
			{
				resource: "things",
				identities: [...identities, "other"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const descriptor = query({
		resource: "things",
		mode: "list",
		select: ["name"],
		where: { status: "Running" },
	});
	const ownerView = runtime.watch(descriptor);
	ownerView.subscribe(() => {});
	const client = new BrowserQueries(
		[definition],
		{
			send: () => undefined,
			retry: async () => {
				throw new Error("Unexpected acquisition");
			},
		},
		16,
	);
	const sync = (accessChanged = false) =>
		client.apply(
			runtime.readModelSnapshot(),
			runtime.accessSnapshot(),
			[],
			[],
			false,
			accessChanged,
		);
	sync();
	const view = client.watch(descriptor);
	view.subscribe(() => {});
	const unbound = client.watch(
		query({
			resource: "things",
			mode: "list",
			select: ["name", "status"],
			where: { status: "Running" },
		}),
	);
	const ownerBefore = ownerView.getSnapshot();
	const before = view.getSnapshot();
	const unboundBefore = unbound.getSnapshot();
	const retainedData = new Set([
		...ownerBefore.rows.map((row) => row.data),
		...before.rows.map((row) => row.data),
		...unboundBefore.rows.map((row) => row.data),
	]);
	let retainedRowWalks = 0;
	const keys = Object.keys;
	t.mock.method(Object, "keys", (value: object) => {
		if (retainedData.has(value)) retainedRowWalks++;
		return keys(value);
	});

	runtime.setAccess({ decisions: [{ scope: "unrelated", state: "allowed" }] });
	for (const notify of sync(true)) notify();
	assert.equal(ownerView.getSnapshot(), ownerBefore);
	assert.equal(view.getSnapshot(), before);
	assert.equal(unbound.getSnapshot(), unboundBefore);
	assert.ok(
		retainedRowWalks > 0,
		"the reset compares rebuilt results with the still-permitted displayed rows",
	);

	retainedRowWalks = 0;
	for (let index = 0; index < 3; index++) {
		runtime.observe({ facts: [fact("other", { name: `Other ${index}` })] });
		for (const notify of sync()) notify();
		assert.equal(ownerView.getSnapshot(), ownerBefore);
		assert.equal(view.getSnapshot(), before);
		assert.equal(unbound.getSnapshot(), unboundBefore);
	}
	assert.equal(
		retainedRowWalks,
		0,
		"unchanged projector results bypass repeat deep comparison in both owner and tab",
	);
	ownerView.dispose();
	view.dispose();
	unbound.dispose();
});
