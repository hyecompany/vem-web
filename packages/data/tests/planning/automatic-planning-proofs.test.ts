// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { MemoryPersistence } from "@hyecompany/vem-data/testing";

const descriptor = query({
	resource: "tasks",
	mode: "one",
	identity: "a",
	select: ["title", "notes"],
});
const observation = {
	facts: [
		{
			resource: "tasks",
			identity: "a",
			presence: "present" as const,
			values: { title: "Walk", notes: "Protected notes" },
			basis: ["public"],
		},
	],
};
const fieldAccess = { notes: "notes:read" };

test("restoration applies current field policy before exposing formerly public persisted data", {
	timeout: 5000,
}, async (t) => {
	const persistence = new MemoryPersistence();
	const previous = createRuntime({
		persistence,
		resources: [{ name: "tasks", persist: () => true }],
	});
	await previous.ready;
	previous.observe(observation);
	await previous.flush();
	previous.close();
	const current = createRuntime({
		persistence,
		access: [{ scope: "notes:read", state: "denied" }],
		resources: [{ name: "tasks", fieldAccess, persist: () => true }],
	});
	t.after(() => current.close());
	await current.ready;
	assert.equal(
		current.readModelSnapshot().records[0]?.confirmed?.values.notes,
		undefined,
	);
	const handle = current.watch(descriptor);
	assert.equal(handle.getSnapshot().rows[0]?.data.title, "Walk");
	current.setAccess({ decisions: [{ scope: "notes:read", state: "allowed" }] });
	assert.equal(handle.getSnapshot().rows[0]?.data.notes, undefined);
});

test("incoming evidence under known denial cannot revive on a later native grant", (t) => {
	const runtime = createRuntime({
		access: [{ scope: "notes:read", state: "denied" }],
		resources: [{ name: "tasks", fieldAccess }],
	});
	t.after(() => runtime.close());
	runtime.observe(observation);
	const handle = runtime.watch(descriptor);
	assert.equal(handle.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(handle.getSnapshot().rows[0]?.data.notes, undefined);
	runtime.setAccess({ decisions: [{ scope: "notes:read", state: "allowed" }] });
	assert.equal(handle.getSnapshot().rows[0]?.data.notes, undefined);
	assert.equal(
		runtime.readModelSnapshot().records[0]?.confirmed?.values.notes,
		undefined,
	);
});
