// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	type AccessSnapshot,
	createRuntime,
	DexiePersistence,
	type PersistenceAdapter,
} from "@hyecompany/vem-data/runtime";
import { deferred, MemoryPersistence } from "@hyecompany/vem-data/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

const resource = { name: "tasks", persist: () => true };
const selected = query({
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
			values: { title: "Public title" },
			basis: ["public"],
		},
		{
			resource: "tasks",
			identity: "a",
			values: { notes: "Saved notes" },
			basis: ["read"],
		},
	],
} as const;
async function seed(persistence: PersistenceAdapter) {
	const runtime = createRuntime({
		contextId: "alice",
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "write", state: "denied" },
		],
		resources: [resource],
		persistence,
	});
	await runtime.ready;
	runtime.observe(observation);
	await runtime.flush();
	runtime.close();
}

for (const backend of ["memory", "dexie"] as const) {
	test(`${backend}: identifying the same caller resumes saved permissions across successive owners`, async () => {
		const memory = new MemoryPersistence();
		const name = `authority-${crypto.randomUUID()}`;
		const storage = () =>
			backend === "memory"
				? memory
				: new DexiePersistence(name, { indexedDB, IDBKeyRange });
		await seed(storage());
		for (let restart = 0; restart < 3; restart++) {
			const runtime = createRuntime({
				contextId: "discovering",
				resources: [resource],
				persistence: storage(),
			});
			try {
				await runtime.ready;
				const view = runtime.watch(selected);
				assert.equal(view.getSnapshot().rows[0]?.data.title, "Public title");
				assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
				runtime.setAccess({ contextId: "alice", decisions: [] });
				assert.equal(runtime.access("read"), "allowed");
				assert.equal(runtime.access("write"), "denied");
				assert.equal(view.getSnapshot().rows[0]?.data.notes, "Saved notes");
				assert.equal(view.getSnapshot().rows[0]?.fields.notes?.stale, true);
				await runtime.flush();
				view.dispose();
			} finally {
				runtime.close();
			}
		}
		const different = createRuntime({
			contextId: "bob",
			resources: [resource],
			persistence: storage(),
		});
		try {
			await different.ready;
			assert.equal(different.access("read"), "unknown");
			assert.equal(
				different.watch(selected).getSnapshot().rows[0]?.data.notes,
				undefined,
			);
		} finally {
			different.close();
		}
	});
}

test("a current denial outranks late saved permissions and regrant cannot resurrect retired payload", async (t) => {
	const persistence = new MemoryPersistence();
	await seed(persistence);
	const saved = await persistence.load();
	const load = deferred<typeof saved>();
	persistence.load = () => load.promise;
	const runtime = createRuntime({
		contextId: "alice",
		resources: [resource],
		persistence,
	});
	t.after(() => runtime.close());
	runtime.revoke("read");
	load.resolve(saved);
	await runtime.ready;
	const view = runtime.watch(selected);
	t.after(() => view.dispose());
	assert.equal(runtime.access("read"), "denied");
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	runtime.observe({
		facts: [{ ...observation.facts[1], values: { notes: "Current notes" } }],
	});
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Current notes");
	await runtime.flush();
});

test("a failed permission checkpoint preserves live data, fences later payload, and keeps public storage", async (t) => {
	const persistence = new MemoryPersistence();
	await seed(persistence);
	const runtime = createRuntime({
		contextId: "alice",
		resources: [resource],
		persistence,
	});
	t.after(() => runtime.close());
	await runtime.ready;
	persistence.writeAccess = async () => {
		throw new Error("Permission storage failed");
	};
	runtime.setAccess({ decisions: [{ scope: "extra", state: "allowed" }] });
	runtime.observe({
		facts: [{ ...observation.facts[1], values: { notes: "Live notes" } }],
	});
	assert.equal(
		runtime.watch(selected).getSnapshot().rows[0]?.data.notes,
		"Live notes",
	);
	await assert.rejects(runtime.flush(), /Permission storage failed/);
	assert.ok(
		[...persistence.facts.values()].some(
			(fact) => fact.value === "Public title",
		),
	);
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.value === "Live notes"),
		false,
	);
	const saved = await persistence.load();
	const restoredStore = new MemoryPersistence();
	restoredStore.load = async () => saved;
	const restored = createRuntime({
		contextId: "alice",
		resources: [resource],
		persistence: restoredStore,
	});
	t.after(() => restored.close());
	await restored.ready;
	assert.notEqual(restored.access("read"), "allowed");
	assert.equal(
		restored.watch(selected).getSnapshot().rows[0]?.data.notes,
		undefined,
	);
});

test("the latest independent permission decision wins across saved contexts", async (t) => {
	for (const backend of ["memory", "dexie"] as const) {
		const storage =
			backend === "memory"
				? new MemoryPersistence()
				: new DexiePersistence(`independent-${crypto.randomUUID()}`, {
						indexedDB,
						IDBKeyRange,
					});
		const snapshot = (
			contextId: string,
			state: "denied" | "allowed",
		): AccessSnapshot => ({
			contextId,
			epoch: contextId,
			revision: 1,
			scopes: { shared: { state, generation: 1, contextIndependent: true } },
		});
		await storage.writeAccess(snapshot("older", "denied"));
		await storage.writeAccess(snapshot("newer", "allowed"));
		const runtime = createRuntime({
			contextId: "third",
			resources: [resource],
			persistence: storage,
		});
		t.after(() => runtime.close());
		await runtime.ready;
		assert.equal(runtime.access("shared"), "allowed", backend);
		runtime.setAccess({
			decisions: [
				{ scope: "shared", state: "denied", contextIndependent: false },
			],
		});
		assert.equal(runtime.access("shared"), "denied", backend);
		assert.equal(
			runtime.accessSnapshot().scopes.shared?.contextIndependent,
			false,
		);
	}
});
