// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";
import { fact, list, options, resource, tick } from "../support/scenario.js";

test("late hydration cannot outrank a current response while durable writes preserve the storage high-water mark", async () => {
	const persistence = new MemoryPersistence();
	const definition = resource({
		persist: () => true,
		persistRelationship: () => true,
	});
	const membership = {
		resource: "things",
		identities: ["a"],
		complete: true,
		basis: ["read"],
	};
	const relation = (identity: string) => ({
		resource: "things",
		identity: "a",
		relationship: "related",
		targets: [{ resource: "things", identity }],
		complete: true,
		basis: ["read"],
	});
	const first = createRuntime({ ...options(definition), persistence });
	await first.ready;
	for (let index = 0; index < 20; index++)
		first.observe({
			facts: [fact("a", { name: `old-${index}`, status: "Stopped" })],
		});
	first.observe({
		memberships: [membership],
		relationships: [relation("old")],
	});
	await first.flush();
	first.close();
	const snapshot = await persistence.load();
	const high = Math.max(
		...snapshot.facts.map((value) => value.revision),
		...snapshot.memberships.map((value) => value.revision),
	);
	const hydration = deferred<typeof snapshot>();
	const response = deferred<ObservationBatch>();
	let reads = 0;
	persistence.load = () => hydration.promise;
	const second = createRuntime({
		...options({
			...definition,
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status"],
					membership: true,
					run: async () => {
						reads++;
						return response.promise;
					},
				},
			],
		}),
		persistence,
	});
	try {
		const result = second.read(list);
		await tick();
		hydration.resolve(snapshot);
		await second.ready;
		response.resolve({
			facts: [fact("a", { name: "Fresh", status: "Running" })],
			memberships: [membership],
			relationships: [relation("current")],
		});
		const value = await result;
		assert.equal(reads, 1);
		assert.equal(value.rows[0]?.data.name, "Fresh");
		assert.equal(value.rows[0]?.data.status, "Running");
		assert.equal(value.rows[0]?.fields.name?.stale, undefined);
		assert.equal(value.confirmed.complete, true);
		assert.equal(value.settled, true);
		assert.deepEqual(second.relationship("things", "a", "related")?.targets, [
			{ resource: "things", identity: "current" },
		]);
		assert.equal(second.relationship("things", "a", "related")?.complete, true);
		await second.flush();
		const saved = [...persistence.facts.values()].find(
			(value) => value.field === "name",
		);
		assert.equal(saved?.value, "Fresh");
		assert.ok(saved && saved.revision > high);
		assert.ok(
			[...persistence.memberships.values()].every(
				(value) => value.revision > high,
			),
		);
	} finally {
		second.close();
	}
});

test("quarantined collection restoration cannot establish a stale filter match", async () => {
	const persistence = new MemoryPersistence();
	const membership = {
		resource: "things",
		where: { status: "Running" },
		identities: ["a"],
		complete: true,
		basis: ["read"],
	};
	const observed = {
		facts: [fact("a", { name: "A", status: "Running" })],
		memberships: [membership],
	};
	const definition = resource({
		persist: () => true,
		sources: [
			{
				key: "collection",
				mode: "list",
				fields: ["name", "status"],
				membership: true,
				run: async () => observed,
			},
		],
	});
	const first = createRuntime({ ...options(definition), persistence });
	await first.ready;
	first.observe(observed);
	await first.flush();
	first.close();
	const second = createRuntime({
		resources: [definition],
		contextId: "discovering",
		persistence,
	});
	try {
		await second.ready;
		second.setAccess({
			contextId: "alice",
			decisions: [{ scope: "read", state: "allowed" }],
		});
		const descriptor = query({
			resource: "things",
			mode: "list",
			select: ["name"],
			where: membership.where,
		});
		const before = second.watch(descriptor).getSnapshot();
		assert.equal(before.rows.length, 0);
		assert.equal(before.unresolved.length, 1);
		assert.equal(before.unresolved[0]?.data.name, "A");
		const after = await second.read(descriptor);
		assert.equal(after.rows.length, 1);
		assert.equal(after.unresolved.length, 0);
		assert.equal(after.confirmed.complete, true);
	} finally {
		second.close();
	}
});
