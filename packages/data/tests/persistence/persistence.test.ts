// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { Dexie } from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { grantKey } from "../../src/access.js";
import { query } from "../../src/descriptors.js";
import {
	DexiePersistence,
	persistenceSchemaVersion,
} from "../../src/persistence.js";
import type {
	ActionJournal,
	PersistedFact,
	PersistedMembership,
} from "../../src/types.js";

for (const previousVersion of [1, 2])
	test(
		"storage version " +
			previousVersion +
			" upgrades preserve evidence and journals and reject newer formats",
		async () => {
			const name = `current-${crypto.randomUUID()}`;
			const stores = {
				facts: "key,resource,revision",
				relationships: "key,resource,revision",
				memberships: "key,resource,revision",
				actions: "id,terminal,snapshot.revision",
				tombstones: "scope",
				accessBindings: "key",
				access: "contextId,savedAt",
			};
			const journal: ActionJournal = {
				id: "unfinished",
				command: {
					kind: "command",
					resource: "things",
					name: "go",
					input: undefined,
				},
				bases: [{ scope: "public", generation: 0 }],
				possibleSubmission: true,
				metadata: { operation: "server-operation" },
				snapshot: {
					id: "unfinished",
					resource: "things",
					name: "go",
					contextId: "anonymous",
					phase: "running",
					recovery: "saved",
					revision: 7,
					controls: { canCancel: false, canRetry: false },
				},
			};
			const basis = { scope: "read", contextId: "alice", generation: 1 };
			const relation: PersistedFact = {
				key: "used-by",
				kind: "relationship",
				resource: "things",
				identity: "a",
				field: "used_by",
				value: {
					targets: [{ resource: "things", identity: "b" }],
					complete: true,
				},
				bases: [basis],
				dependencies: [],
				supports: [{ bases: [basis], dependencies: [], liveness: "snapshot" }],
				liveness: "snapshot",
				source: "observed",
				revision: 2,
			};

			const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
			legacy
				.version(previousVersion)
				.stores(
					Object.fromEntries(
						Object.entries(stores).filter(
							([key]) => previousVersion !== 1 || key !== "access",
						),
					),
				);
			await legacy.table("relationships").put(relation);
			await legacy.table("actions").put(journal);
			const retired = { scope: "retired", contextId: "alice", generation: 1 };
			await legacy
				.table("tombstones")
				.put({ scope: grantKey(retired), generation: 1 });
			legacy.close();
			const current = new DexiePersistence(name, { indexedDB, IDBKeyRange });
			assert.equal(persistenceSchemaVersion, 3);
			const restored = await current.load();
			assert.deepEqual(restored.access, []);
			assert.equal(restored.revoked[grantKey(retired)], 1);
			assert.deepEqual(restored.actions[0]?.snapshot, journal.snapshot);
			assert.deepEqual(restored.actions[0]?.metadata, journal.metadata);
			assert.deepEqual(restored.facts, [relation]);
			const membership: PersistedMembership = {
				key: "filtered",
				resource: "things",
				revision: 3,
				where: query({
					resource: "things",
					mode: "list",
					select: ["name"],
					where: {
						$or: [
							{ name: { contains: "a" } },
							{ description: { contains: "b" } },
						],
					},
				}).where,
				identities: ["a"],
				complete: true,
				observedComplete: true,
				bases: [{ scope: "public", generation: 0 }],
				supports: [],
				liveness: "immutable",
			};
			await current.writeFacts([], [membership]);
			assert.deepEqual(
				(await current.load()).memberships[0]?.where,
				membership.where,
			);
			const inspected = new Dexie(name, { indexedDB, IDBKeyRange });
			await inspected.open();
			assert.deepEqual(
				inspected.tables.map((table) => table.name).sort(),
				Object.keys(stores).sort(),
			);
			assert.deepEqual(await inspected.table("facts").toArray(), []);
			assert.deepEqual(await inspected.table("relationships").toArray(), [
				relation,
			]);
			await current.revoke([basis]);
			assert.deepEqual((await current.load()).facts, []);
			assert.equal(
				(await inspected.table("tombstones").get(grantKey(basis)))?.generation,
				1,
			);
			assert.deepEqual(
				(await current.load()).actions[0]?.metadata,
				journal.metadata,
			);
			inspected.close();
			current.close();
			const future = new Dexie(name, { indexedDB, IDBKeyRange });
			future.version(persistenceSchemaVersion + 1).stores(stores);
			await future.open();
			future.close();
			const outdated = new DexiePersistence(name, { indexedDB, IDBKeyRange });
			await assert.rejects(outdated.load(), /newer Vem Data runtime/);
			outdated.close();
		},
	);

test("durable retirement rejects queued old-authority writes but preserves independent bases", async () => {
	const db = new DexiePersistence(`test-${crypto.randomUUID()}`, {
		indexedDB,
		IDBKeyRange,
	});
	const alice = { scope: "read", generation: 1, contextId: "alice" };
	const bob = { scope: "read", generation: 1, contextId: "bob" };
	const fact: PersistedFact = {
		key: "field",
		resource: "things",
		identity: "a",
		field: "name",
		value: "Private",
		bases: [alice],
		dependencies: [],
		supports: [{ bases: [alice], dependencies: [], liveness: "snapshot" }],
		liveness: "snapshot",
		source: "observed",
		revision: 1,
		contextId: "alice",
	};
	await db.writeFacts(
		[
			fact,
			{
				...fact,
				key: "independent",
				bases: [alice, bob],
				supports: [
					{ bases: [alice, bob], dependencies: [], liveness: "snapshot" },
				],
			},
		],
		[],
	);
	await db.revoke([alice]);
	await db.writeFacts([{ ...fact, revision: 99 }], []);
	const stored = await db.load();
	assert.deepEqual(
		stored.facts.map((row) => row.key),
		["independent"],
	);
	await db.writeFacts(
		[
			{
				...fact,
				bases: [bob],
				supports: [{ bases: [bob], dependencies: [], liveness: "snapshot" }],
				contextId: "bob",
				revision: 100,
			},
		],
		[],
	);
	assert.equal((await db.load()).facts.length, 2);
	db.close();
});

test("paged hydration and durable retention bound settled cache while preserving unknown attempts", async () => {
	const db = new DexiePersistence(
		`test-${crypto.randomUUID()}`,
		{ indexedDB, IDBKeyRange },
		{ maxFacts: 3, maxMemberships: 2, maxSettledActions: 2 },
	);
	const basis = { scope: "public", generation: 0 };
	await db.writeFacts(
		Array.from(
			{ length: 7 },
			(_, index): PersistedFact => ({
				key: String(index),
				resource: "things",
				identity: String(index),
				field: "name",
				kind: index % 2 === 0 ? "relationship" : undefined,
				value: `Item ${index}`,
				bases: [basis],
				dependencies: [],
				supports: [{ bases: [basis], dependencies: [], liveness: "snapshot" }],
				liveness: "snapshot",
				source: "observed",
				revision: index,
			}),
		),
		[],
	);
	for (let index = 0; index < 7; index++)
		await db.writeAction({
			id: `action-${index}`,
			command: {
				kind: "command",
				resource: "things",
				name: "go",
				input: undefined,
			},
			bases: [basis],
			possibleSubmission: true,
			snapshot: {
				id: `action-${index}`,
				resource: "things",
				name: "go",
				contextId: "anonymous",
				phase: "settled",
				outcome:
					index < 2
						? { kind: "unknown", message: "Investigate" }
						: { kind: "succeeded" },
				recovery: "saved",
				revision: index,
				controls: { canCancel: false, canRetry: false },
			},
		});
	const pages = [];
	for await (const page of db.loadPages(2)) pages.push(page);
	assert.ok(
		pages.every((page) => page.facts.length <= 2 && page.actions.length <= 2),
	);
	assert.deepEqual(
		pages
			.flatMap((page) => page.facts)
			.map((row) => row.key)
			.sort(),
		["4", "5", "6"],
	);
	const actions = pages.flatMap((page) => page.actions);
	assert.equal(actions.length, 4);
	assert.equal(
		actions.filter((action) => action.snapshot.outcome?.kind === "unknown")
			.length,
		2,
	);
	db.close();
});
