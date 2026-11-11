// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import { createRuntime, DexiePersistence } from "@hyecompany/vem-data/runtime";
import { MemoryPersistence } from "@hyecompany/vem-data/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

for (const backend of ["memory", "dexie"] as const) {
	test(`${backend}: cold restoration composes immutable evidence and preserves explicit invalidation`, {
		timeout: 5000,
	}, async (t) => {
		const memory = new MemoryPersistence();
		const name = `immutable-${crypto.randomUUID()}`;
		const storage = () =>
			backend === "memory"
				? memory
				: new DexiePersistence(name, { indexedDB, IDBKeyRange });
		const owner = () =>
			createRuntime({
				contextId: "alice",
				access: [{ scope: "read", state: "allowed" }],
				persistence: storage(),
				resources: [{ name: "catalogue", persist: () => true }],
			});
		const selected = query({
			resource: "catalogue",
			mode: "one",
			identity: "release-1",
			select: ["title", "measurement"],
		});
		const first = owner();
		await first.ready;
		first.observe({
			facts: [
				{
					resource: "catalogue",
					identity: "release-1",
					presence: "present",
					values: { title: "Release one", measurement: 12 },
					basis: ["read"],
					liveness: { all: ["immutable", { any: ["immutable", "snapshot"] }] },
					fieldLiveness: { measurement: "snapshot" },
				},
			],
			memberships: [
				{
					resource: "catalogue",
					identities: ["release-1"],
					complete: true,
					basis: ["read"],
					liveness: { all: ["immutable"] },
				},
			],
		});
		await first.flush();
		first.close();
		const second = owner();
		await second.ready;
		const restored = await second.read(selected);
		assert.equal(restored.rows[0]?.fields.title?.liveness, "immutable");
		assert.notEqual(restored.rows[0]?.fields.title?.stale, true);
		assert.equal(restored.rows[0]?.fields.measurement?.stale, true);
		assert.equal(second.membership("catalogue")?.complete, true);
		second.observe({
			invalidate: [
				{ resource: "catalogue", identity: "release-1", field: "title" },
			],
			invalidateMemberships: [{ resource: "catalogue" }],
		});
		await second.flush();
		second.close();
		const third = owner();
		t.after(() => third.close());
		await third.ready;
		const invalidated = await third.read(selected);
		assert.equal(invalidated.rows[0]?.data.title, "Release one");
		assert.equal(invalidated.rows[0]?.fields.title?.stale, true);
		assert.equal(third.membership("catalogue")?.complete, false);
	});

	test(`${backend}: invalidating unloaded evidence persists an ordered payload-free marker`, {
		timeout: 5000,
	}, async (t) => {
		const memory = new MemoryPersistence();
		const name = `unloaded-${crypto.randomUUID()}`;
		const storage = () =>
			backend === "memory"
				? memory
				: new DexiePersistence(name, { indexedDB, IDBKeyRange });
		const owner = () =>
			createRuntime({
				persistence: storage(),
				resources: [{ name: "catalogue", persist: () => true }],
			});
		const ref = {
			resource: "catalogue",
			identity: "release-1",
			field: "title",
		};
		const publish = (runtime: ReturnType<typeof owner>, title: string) =>
			runtime.observe({
				memberships: [
					{
						resource: ref.resource,
						identities: [ref.identity],
						complete: true,
						basis: ["public"],
						liveness: { all: ["immutable"] },
					},
				],
				facts: [
					{
						resource: ref.resource,
						identity: ref.identity,
						presence: "present",
						values: { title },
						basis: ["public"],
						liveness: "immutable",
					},
				],
			});
		const first = owner();
		await first.ready;
		publish(first, "Old title");
		await first.flush();
		first.close();
		const second = owner();
		second.observe({
			invalidate: [ref],
			invalidateMemberships: [{ resource: ref.resource }],
		});
		await second.flush();
		second.close();
		const saved = storage();
		const stored = await saved.load();
		const membershipMarker = stored.memberships[0];
		assert.equal(membershipMarker?.deleted, true);
		assert.deepEqual(membershipMarker?.identities, []);
		assert.deepEqual(membershipMarker?.bases, []);
		const marker = stored.facts.find((fact) => fact.field === "title");
		assert.equal(marker?.deleted, true);
		assert.equal(marker?.value, undefined);
		assert.equal(marker?.identity, undefined);
		assert.deepEqual(marker?.bases, []);
		assert.deepEqual(marker?.supports, []);
		saved.close();
		const third = owner();
		await third.ready;
		const selected = query({
			resource: ref.resource,
			identity: ref.identity,
			mode: "one",
			select: ["title"],
		});
		assert.equal((await third.read(selected)).rows[0]?.data.title, undefined);
		assert.equal(third.membership(ref.resource), undefined);
		publish(third, "Newly established");
		await third.flush();
		third.close();
		const fourth = owner();
		t.after(() => fourth.close());
		await fourth.ready;
		assert.equal(fourth.membership(ref.resource)?.complete, true);
		assert.equal(
			(await fourth.read(selected)).rows[0]?.data.title,
			"Newly established",
		);
	});
}
