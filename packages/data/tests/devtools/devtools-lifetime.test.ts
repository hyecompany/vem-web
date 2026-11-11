// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, edit, query } from "../../src/descriptors.js";
import { inspectClient } from "../../src/devtools.js";
import { createTestClient, deferred } from "../../src/testing.js";
import type { DataClient, PreparedEdit } from "../../src/types.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("live inspection uses opaque ids, omits command inputs, and withdraws descriptor context synchronously", async (t) => {
	const selected = query({
		resource: "widgets",
		mode: "one",
		identity: "protected-target",
		select: ["name"],
	});
	const intended = command({
		resource: "widgets",
		name: "change",
		target: "protected-target",
		input: { password: "protected-password" },
	});
	const testClient = createTestClient({
		queries: [
			{
				query: selected,
				rows: [
					{ identity: "protected-target", data: { name: "protected-name" } },
				],
			},
		],
		commands: [{ command: intended, outcome: { kind: "succeeded" } }],
	});
	const inspector = inspectClient(testClient.client);
	t.after(() => {
		inspector.close();
		testClient.close();
	});
	const watched = inspector.client.watch(selected);
	const stop = watched.subscribe(() => undefined);
	const availability = inspector.client.watchAvailability(intended);
	const stopAvailability = availability.subscribe(() => undefined);
	t.after(() => {
		stop();
		stopAvailability();
	});
	assert.equal(
		inspector.getSnapshot().queries[0]?.result?.rows[0]?.data.name,
		"protected-name",
	);
	assert.equal(
		JSON.stringify(inspector.getSnapshot()).includes("protected-password"),
		false,
	);
	assert.match(inspector.getSnapshot().commands[0]?.id ?? "", /^[\da-f-]{36}$/);
	testClient.setQuery({
		query: query({
			resource: "widgets",
			mode: "one",
			identity: "another",
			select: ["name"],
		}),
		rows: [{ identity: "another", data: { name: "Another" } }],
	});
	assert.equal(
		inspector.getSnapshot().queries[0]?.descriptor.identity,
		"protected-target",
	);
	assert.equal(
		inspector.getSnapshot().commands[0]?.descriptor.target,
		"protected-target",
	);
	testClient.setQuery({ query: selected, status: "denied" });
	assert.equal(
		JSON.stringify(inspector.getSnapshot()).includes("protected-target"),
		false,
	);
	assert.equal(
		JSON.stringify(inspector.getSnapshot()).includes("protected-name"),
		false,
	);
	assert.equal(inspector.getSnapshot().queries[0]?.result?.rows.length, 0);
	assert.equal(
		inspector.getSnapshot().commands[0]?.descriptor.target,
		undefined,
	);
});

test("late editor preparation cannot repopulate a closed inspector and errors never copy private server text", async (t) => {
	const testClient = createTestClient({ resources: ["widgets"] });
	t.after(() => testClient.close());
	const pending = deferred<PreparedEdit>();
	const source = new Proxy(testClient.client, {
		get(target, property) {
			if (property === "prepareEdit") return () => pending.promise;
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as DataClient;
	const inspector = inspectClient(source);
	const descriptor = edit({
		resource: "widgets",
		name: "settings",
		target: "one",
	});
	const preparation = inspector.client.prepareEdit(descriptor);
	assert.equal(inspector.getSnapshot().edits.length, 1);
	inspector.close();
	pending.resolve({
		descriptor,
		values: { secret: "protected-value" },
		baseline: {},
		fieldDisclosure: { secret: { scope: "public", generation: 0 } },
		etag: "private-etag",
		writeAccess: { all: [] },
		contextId: "public",
		accessGeneration: 0,
	});
	await preparation;
	assert.equal(inspector.getSnapshot().edits.length, 0);
	const failedSource = new Proxy(source, {
		get(target, property) {
			return property === "prepareEdit"
				? async () => {
						throw new Error("protected-value");
					}
				: Reflect.get(target, property);
		},
	});
	const failed = inspectClient(failedSource);
	t.after(() => failed.close());
	await assert.rejects(
		failed.client.prepareEdit(descriptor),
		/protected-value/,
	);
	assert.equal(
		JSON.stringify(failed.getSnapshot()).includes("protected-value"),
		false,
	);
});

test("a later subscriber can complete a previously inactive loading fixture", {
	timeout: 2000,
}, async (t) => {
	const selected = query({
		resource: "widgets",
		mode: "list",
		select: ["name"],
	});
	const fixture = createTestClient({
		queries: [{ query: selected, status: "loading" }],
	});
	t.after(() => fixture.close());
	const first = fixture.client.watch(selected);
	const release = first.subscribe(() => undefined);
	await tick();
	assert.equal(first.getSnapshot().fetching, true);
	release();
	first.dispose();
	const second = fixture.client.watch(selected);
	const stop = second.subscribe(() => undefined);
	t.after(stop);
	await tick();
	fixture.setQuery({
		query: selected,
		rows: [{ identity: "one", data: { name: "One" } }],
	});
	for (let i = 0; i < 100 && !second.getSnapshot().settled; i++) await tick();
	assert.equal(second.getSnapshot().settled, true);
	assert.equal(second.getSnapshot().rows[0]?.data.name, "One");
});
