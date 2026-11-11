// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import {
	deletedFact,
	deletedMembership,
} from "../../src/persistence-records.js";
import { createRuntime, DexiePersistence } from "../../src/runtime.js";
import { MemoryPersistence } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";

for (const backend of ["memory", "dexie"] as const) {
	test(`${backend}: ordering markers survive unrelated revocation and reject delayed older payload`, async (t) => {
		const memory = new MemoryPersistence();
		const name = `marker-order-${crypto.randomUUID()}`;
		const storage = () =>
			backend === "memory"
				? memory
				: new DexiePersistence(name, { indexedDB, IDBKeyRange });
		const originalStorage = storage();
		const runtime = createRuntime({
			persistence: originalStorage,
			contextId: "alice",
			access: [{ scope: "read", state: "allowed" }],
			resources: [{ name: "records", persist: () => true }],
		});
		await runtime.ready;
		runtime.observe({
			facts: [
				{
					resource: "records",
					identity: "private-id",
					values: { title: "Protected payload" },
					presence: "present",
					basis: ["read"],
					liveness: "immutable",
				},
			],
			memberships: [
				{
					resource: "records",
					identities: ["private-id"],
					complete: true,
					basis: ["read"],
					liveness: "immutable",
				},
			],
		});
		await runtime.flush();
		const original = await originalStorage.load();
		const fact = original.facts.find((row) => row.field === "title");
		const membership = original.memberships[0];
		assert.ok(fact);
		assert.ok(membership);
		runtime.close();
		const saved = storage();
		t.after(() => saved.close());
		await saved.writeFacts(
			[deletedFact({ ...fact, revision: fact.revision + 1 })],
			[deletedMembership({ ...membership, revision: membership.revision + 1 })],
		);
		await saved.revoke([
			{ scope: "unrelated", contextId: "alice", generation: 1 },
		]);
		await saved.writeFacts([fact], [membership]);
		const persisted = await saved.load();
		const retired = persisted.facts.find((row) => row.key === fact.key);
		const retiredMembership = persisted.memberships.find(
			(row) => row.key === membership.key,
		);
		assert.equal(retired?.deleted, true);
		assert.equal(retired?.identity, undefined);
		assert.equal(retired?.value, undefined);
		assert.deepEqual(retired?.bases, []);
		assert.deepEqual(retired?.supports, []);
		assert.equal(retiredMembership?.deleted, true);
		assert.deepEqual(retiredMembership?.identities, []);
		assert.deepEqual(retiredMembership?.bases, []);
		await saved.writeFacts(
			[{ ...fact, revision: fact.revision + 2 }],
			[{ ...membership, revision: membership.revision + 2 }],
		);
		const current = await saved.load();
		assert.equal(
			current.facts.find((row) => row.key === fact.key)?.value,
			"Protected payload",
		);
		assert.equal(
			current.memberships.find((row) => row.key === membership.key)?.complete,
			true,
		);
	});
}

for (const backend of ["memory", "dexie"] as const) {
	test(`${backend}: unloaded relationship invalidation restores aggregate uncertainty and preserves independent edges`, async (t) => {
		const memory = new MemoryPersistence();
		const name = `relationship-marker-${crypto.randomUUID()}`;
		const storage = () =>
			backend === "memory"
				? memory
				: new DexiePersistence(name, { indexedDB, IDBKeyRange });
		const resources = [{ name: "records", persistRelationship: () => true }];
		const ref = {
			resource: "records",
			identity: "parent",
			relationship: "children",
		};
		const observation: ObservationBatch = {
			relationships: [
				{
					...ref,
					targets: [{ resource: "records", identity: "child" }],
					complete: true,
					basis: ["public"],
					liveness: "immutable",
				},
			],
		};
		const control = createRuntime({ resources });
		control.observe(observation);
		control.observe({ invalidate: [ref] });
		const expected = control.relationship("records", "parent", "children");
		assert.equal(expected?.stale, true);
		assert.equal(expected?.targets.length, 1);
		control.close();
		const first = createRuntime({ resources, persistence: storage() });
		await first.ready;
		first.observe(observation);
		await first.flush();
		first.close();
		const second = createRuntime({ resources, persistence: storage() });
		second.observe({ invalidate: [ref] });
		await second.flush();
		second.close();
		const third = createRuntime({ resources, persistence: storage() });
		t.after(() => third.close());
		await third.ready;
		assert.deepEqual(
			third.relationship("records", "parent", "children"),
			expected,
		);
		third.observe(observation);
		assert.equal(
			third.relationship("records", "parent", "children")?.complete,
			true,
		);
		assert.equal(
			third.relationship("records", "parent", "children")?.stale,
			false,
		);
	});
}
