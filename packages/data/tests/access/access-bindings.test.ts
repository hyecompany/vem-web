// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, edit, query } from "@hyecompany/vem-data";
import {
	type AccessBinding,
	createRuntime,
	DexiePersistence,
	type PersistedFact,
} from "@hyecompany/vem-data/runtime";
import { deferred, MemoryPersistence } from "@hyecompany/vem-data/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { EditSession } from "../../src/edit.js";

const alias = "task:walk:view";
const requires = {
	all: ["owner:project-one:view", "project-one:visible"],
} as const;
const initialAccess = [alias, ...requires.all].map((scope) => ({
	scope,
	state: "allowed" as const,
}));
const resource = { name: "tasks", persist: () => true };
const descriptor = query({
	resource: "tasks",
	mode: "one",
	identity: "walk",
	select: ["title", "notes", "shared"],
});
const facts = [
	{
		resource: "tasks",
		identity: "walk",
		presence: "present" as const,
		values: { title: "Walk" },
		basis: ["public"],
	},
	{
		resource: "tasks",
		identity: "walk",
		values: { notes: "Protected", shared: "Independently public" },
		basis: [alias],
		fieldBasis: { shared: [alias, "public"] },
	},
];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100 && !predicate(); i++) await tick();
	assert.ok(predicate(), "Expected runtime transition");
}

test("binding an existing alias retires its evidence on canonical denial while independent permission survives", {
	timeout: 5000,
}, async (t) => {
	const persistence = new MemoryPersistence();
	const runtime = createRuntime({
		contextId: "alice",
		access: initialAccess,
		resources: [resource],
		persistence,
	});
	t.after(() => runtime.close());
	await runtime.ready;
	runtime.observe({ facts });
	const view = runtime.watch(descriptor);
	t.after(() => view.dispose());
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
	runtime.setAccess({
		decisions: [{ scope: alias, state: "allowed", requires }],
	});
	const generation = runtime.accessSnapshot().scopes[alias]?.generation;
	runtime.setAccess({
		decisions: [{ scope: requires.all[0], state: "unknown" }],
	});
	runtime.setAccess({
		decisions: [{ scope: requires.all[0], state: "allowed" }],
	});
	assert.equal(runtime.accessSnapshot().scopes[alias]?.generation, generation);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
	runtime.revoke(requires.all[0]);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	assert.equal(view.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(view.getSnapshot().rows[0]?.data.shared, "Independently public");
	await runtime.flush();
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.field === "notes"),
		false,
	);
	runtime.setAccess({ decisions: initialAccess });
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	runtime.observe({ facts: facts.slice(1) });
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
});

test("canonical permission withdrawal clears an existing alias-protected draft and action disclosure", {
	timeout: 5000,
}, async (t) => {
	const submitted = deferred<void>();
	const completion = deferred<void>();
	let canceled = false;
	const runtime = createRuntime({
		contextId: "alice",
		access: initialAccess,
		resources: [
			{
				...resource,
				edits: {
					notes: {
						async prepare(descriptor) {
							return {
								descriptor,
								values: { title: "Walk", notes: "Original" },
								baseline: { title: "Walk", notes: "Original" },
								etag: "one",
								disclosure: "public",
								fieldDisclosure: { title: "public", notes: alias },
								writeAccess: alias,
							};
						},
						command: () =>
							command({
								resource: "tasks",
								name: "save",
								target: "walk",
								input: {},
							}),
					},
				},
				commands: {
					save: {
						access: () => alias,
						disclosure: () => alias,
						async cancel() {
							canceled = true;
						},
						async run(_command, context) {
							context.submitted();
							submitted.resolve();
							await completion.promise;
							return { kind: "succeeded" as const };
						},
					},
				},
			},
		],
	});
	const session = new EditSession(
		runtime,
		edit<{ title: string; notes: string }>({
			resource: "tasks",
			name: "notes",
			target: "walk",
		}),
	);
	const stop = session.subscribe(() => undefined);
	t.after(() => {
		stop();
		session.dispose();
		runtime.close();
	});
	await until(() => session.getSnapshot().status === "ready");
	session.set("notes", "Dirty notes");
	const action = runtime.run(
		command({ resource: "tasks", name: "save", target: "walk", input: {} }),
	);
	await submitted.promise;
	assert.equal(runtime.listActivities().length, 1);
	runtime.setAccess({
		decisions: [{ scope: alias, state: "allowed", requires }],
	});
	runtime.revoke(requires.all[1]);
	assert.equal(session.getSnapshot().values.notes, undefined);
	assert.equal(session.getSnapshot().values.title, "Walk");
	assert.equal(session.getSnapshot().canSave, false);
	assert.equal(runtime.listActivities().length, 0);
	assert.equal(canceled, false);
	completion.resolve();
	await action.result;
	runtime.setAccess({ decisions: initialAccess });
	assert.equal(session.getSnapshot().values.notes, undefined);
	assert.equal(runtime.listActivities().length, 0);
});

test("Dexie persists permission bindings before payload hydration and preserves them on clear", {
	timeout: 5000,
}, async (t) => {
	const persistence = new DexiePersistence(`bindings-${crypto.randomUUID()}`, {
		indexedDB,
		IDBKeyRange,
	});
	t.after(() => persistence.close());
	const binding: AccessBinding = {
		key: "alice:task:walk:view",
		scope: alias,
		contextId: "alice",
		requires,
	};
	const fact: PersistedFact = {
		key: "title",
		resource: "tasks",
		identity: "walk",
		field: "title",
		value: "Walk",
		bases: [{ scope: "public", generation: 0 }],
		dependencies: [],
		supports: [
			{
				bases: [{ scope: "public", generation: 0 }],
				dependencies: [],
				liveness: "snapshot",
			},
		],
		liveness: "snapshot",
		source: "observed",
		revision: 1,
	};
	const bindingWrite = persistence.writeAccessBindings([binding]);
	const payloadWrite = persistence.writeFacts([fact], []);
	await Promise.all([bindingWrite, payloadWrite]);
	const pages = [];
	for await (const page of persistence.loadPages(1)) pages.push(page);
	assert.deepEqual(pages[0]?.accessBindings, [binding]);
	assert.equal(pages[0]?.facts.length, 0);
	assert.equal(pages.flatMap((page) => page.facts).length, 1);
	assert.deepEqual((await persistence.load()).accessBindings, [binding]);
	await persistence.clear();
	const cleared = await persistence.load();
	assert.equal(cleared.facts.length, 0);
	assert.deepEqual(cleared.accessBindings, [binding]);
	const firstEmpty = await persistence
		.loadPages(1)
		[Symbol.asyncIterator]()
		.next();
	assert.deepEqual(firstEmpty.value?.accessBindings, [binding]);
});

test("same-caller restoration resumes canonical permissions and their dependent aliases", {
	timeout: 5000,
}, async (t) => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({
		contextId: "alice",
		access: initialAccess,
		resources: [resource],
		persistence,
	});
	await first.ready;
	first.observe({
		facts,
		memberships: [
			{
				resource: "tasks",
				identities: ["walk"],
				complete: true,
				basis: [alias],
				liveness: "immutable",
			},
		],
	});
	first.setAccess({
		decisions: [{ scope: alias, state: "allowed", requires }],
	});
	await first.flush();
	first.close();
	const restored = createRuntime({
		contextId: "alice",
		access: [{ scope: alias, state: "allowed" }],
		resources: [resource],
		persistence,
	});
	t.after(() => restored.close());
	await restored.ready;
	const view = restored.watch(descriptor);
	t.after(() => view.dispose());
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
	assert.equal(view.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(restored.membership("tasks")?.complete, true);
	restored.setAccess({ decisions: [{ scope: "unrelated", state: "allowed" }] });
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
	restored.setAccess({ decisions: initialAccess });
	assert.equal(restored.membership("tasks")?.complete, true);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
	restored.revoke(requires.all[0]);
	assert.equal(restored.membership("tasks"), undefined);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	await restored.flush();
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.field === "notes"),
		false,
	);
});

test("failed binding persistence withdraws old durable aliases and prevents later payload writes", {
	timeout: 5000,
}, async (t) => {
	const persistence = new MemoryPersistence();
	const errors: unknown[] = [];
	const runtime = createRuntime({
		contextId: "alice",
		access: initialAccess,
		resources: [resource],
		persistence,
		onError: (error) => errors.push(error),
	});
	t.after(() => runtime.close());
	await runtime.ready;
	runtime.observe({ facts });
	await runtime.flush();
	assert.ok(
		[...persistence.facts.values()].some((fact) => fact.field === "notes"),
	);
	persistence.writeAccessBindings = async () => {
		throw new Error("Binding storage failed");
	};
	runtime.setAccess({ decisions: [{ scope: alias, requires }] });
	await assert.rejects(runtime.flush(), /Binding storage failed/);
	assert.ok(
		errors.some((error) => String(error).includes("Binding storage failed")),
	);
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.field === "notes"),
		false,
	);
	const view = runtime.watch(descriptor);
	t.after(() => view.dispose());
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Protected");
	runtime.observe({
		facts: [
			{
				resource: "tasks",
				identity: "walk",
				values: { notes: "Still live" },
				basis: [alias],
			},
		],
	});
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Still live");
	await assert.rejects(runtime.flush(), /Binding storage failed/);
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.field === "notes"),
		false,
	);
});

test("an authoritative response can replace an established binding while late old responses cannot change it back", {
	timeout: 5000,
}, async (t) => {
	const oldStarted = deferred<void>();
	const oldResponse = deferred<void>();
	const oldRequires = { all: [requires.all[0]] };
	const nextRequires = { all: [requires.all[1]] };
	let delayedReads = 0;
	const runtime = createRuntime({
		contextId: "alice",
		access: [
			...initialAccess,
			{ scope: alias, state: "allowed", requires: oldRequires },
		],
		resources: [
			{
				...resource,
				derive(_changed, context) {
					const record = context.get("tasks", "walk");
					if (!record?.fields.title || record.fields.notes) return;
					return {
						facts: [
							{
								resource: "tasks",
								identity: "walk",
								values: { notes: "Derived fallback" },
								dependsOn: [
									{ resource: "tasks", identity: "walk", field: "title" },
								],
							},
						],
					};
				},
				sources: [
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						access: alias,
						async run(request) {
							if (request.identity === "delayed" && ++delayedReads === 1) {
								oldStarted.resolve();
								await oldResponse.promise;
								return {
									grants: [
										{
											scope: alias,
											state: "allowed" as const,
											requires: oldRequires,
										},
									],
									facts: [
										{
											resource: "tasks",
											identity: request.identity,
											presence: "present" as const,
											values: { notes: "Old delayed" },
											basis: [alias],
										},
									],
								};
							}
							return {
								grants: [
									{
										scope: alias,
										state: "allowed" as const,
										requires: nextRequires,
									},
								],
								facts: [
									{
										resource: "tasks",
										identity: request.identity,
										presence: "present" as const,
										values: { notes: "New verified" },
										basis: [alias],
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
	runtime.observe({ facts });
	const oldGeneration = runtime.accessSnapshot().scopes[alias]?.generation ?? 0;
	const delayed = runtime.read(
		query({
			resource: "tasks",
			mode: "one",
			identity: "delayed",
			select: ["notes"],
		}),
	);
	await oldStarted.promise;
	runtime.observe({
		invalidate: [{ resource: "tasks", identity: "walk", field: "notes" }],
	});
	const changed = await runtime.read(
		query({ ...descriptor, select: ["notes"] }),
	);
	assert.equal(changed.rows[0]?.data.notes, "New verified");
	assert.ok(
		(runtime.accessSnapshot().scopes[alias]?.generation ?? 0) > oldGeneration,
	);
	assert.deepEqual(
		runtime.accessSnapshot().scopes[alias]?.requires,
		nextRequires,
	);
	oldResponse.resolve();
	const late = await delayed;
	assert.notEqual(late.rows[0]?.data.notes, "Old delayed");
	assert.deepEqual(
		runtime.accessSnapshot().scopes[alias]?.requires,
		nextRequires,
	);
});

test("binding-only dependency recovery permits a fresh authority check instead of reviving old evidence", {
	timeout: 5000,
}, async (t) => {
	let reads = 0;
	const runtime = createRuntime({
		contextId: "alice",
		access: [...initialAccess, { scope: alias, requires }],
		resources: [
			{
				...resource,
				sources: [
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						access: alias,
						async run(request) {
							return {
								grants: [{ scope: alias, state: "allowed" as const }],
								facts: [
									{
										resource: "tasks",
										identity: request.identity,
										presence: "present" as const,
										values: { notes: `Revision ${++reads}` },
										basis: [alias],
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
	const view = runtime.watch(query({ ...descriptor, select: ["notes"] }));
	t.after(() => view.dispose());
	const stop = view.subscribe(() => undefined);
	t.after(stop);
	await until(() => view.getSnapshot().rows[0]?.data.notes === "Revision 1");
	runtime.revoke(requires.all[0]);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	runtime.setAccess({
		decisions: [{ scope: requires.all[0], state: "allowed" }],
	});
	await until(() => view.getSnapshot().rows[0]?.data.notes === "Revision 2");
	assert.equal(reads, 2);
	assert.deepEqual(runtime.accessSnapshot().scopes[alias]?.requires, requires);
});

test("returning to a retired authority admits a fresh source check without restoring old permissions", async (t) => {
	let reads = 0;
	const runtime = createRuntime({
		contextId: "alice",
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["notes"],
						access: alias,
						async run(request) {
							reads++;
							return {
								grants: [{ scope: alias, state: "allowed" as const }],
								facts: [
									{
										resource: "tasks",
										identity: request.identity,
										presence: "present" as const,
										values: { notes: `Read ${reads}` },
										basis: [alias],
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
	const selected = query({ ...descriptor, select: ["notes"] });
	assert.equal((await runtime.read(selected)).rows[0]?.data.notes, "Read 1");
	runtime.setAccess({ contextId: "anonymous", decisions: [] });
	runtime.setAccess({ contextId: "alice", decisions: [] });
	assert.equal(runtime.access(alias), "unknown");
	assert.equal(runtime.watch(selected).getSnapshot().rows.length, 0);
	assert.equal((await runtime.read(selected)).rows[0]?.data.notes, "Read 2");
	assert.equal(reads, 2);
});

test("verified current bindings retire conflicting restored payload without erasing current-owner observations", {
	timeout: 5000,
}, async (t) => {
	const persistence = new MemoryPersistence();
	const oldRequires = { all: [requires.all[0]] };
	const nextRequires = { all: [requires.all[1]] };
	const previous = createRuntime({
		contextId: "alice",
		access: [...initialAccess, { scope: alias, requires: oldRequires }],
		resources: [resource],
		persistence,
	});
	await previous.ready;
	previous.observe({
		facts: [
			{
				resource: "tasks",
				identity: "walk",
				presence: "present",
				values: { notes: "Previous owner payload" },
				basis: [alias],
			},
			{
				resource: "tasks",
				identity: "old-only",
				presence: "present",
				values: { notes: "Must not restore" },
				basis: [alias],
			},
		],
	});
	await previous.flush();
	const oldFacts = [...persistence.facts.values()].filter(
		(fact) => fact.field === "notes",
	);
	previous.close();
	const current = createRuntime({
		contextId: "alice",
		access: [...initialAccess, { scope: alias, requires: nextRequires }],
		resources: [resource],
		persistence,
	});
	t.after(() => current.close());
	current.observe({
		facts: [
			{
				resource: "tasks",
				identity: "walk",
				presence: "present",
				values: { notes: "Current owner value" },
				basis: [alias],
			},
		],
	});
	await current.ready;
	const view = current.watch(query({ ...descriptor, select: ["notes"] }));
	t.after(() => view.dispose());
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Current owner value");
	assert.equal(
		current
			.readModelSnapshot()
			.records.some(
				(record) =>
					record.confirmed?.identity === "old-only" &&
					record.confirmed?.values.notes !== undefined,
			),
		false,
	);
	assert.deepEqual(
		current.accessSnapshot().scopes[alias]?.requires,
		nextRequires,
	);
	await current.flush();
	await persistence.writeFacts(
		oldFacts.map((fact) => ({ ...fact, revision: fact.revision + 1000 })),
		[],
	);
	const saved = await persistence.load();
	assert.equal(
		saved.facts.find(
			(fact) => fact.identity === "walk" && fact.field === "notes",
		)?.value,
		"Current owner value",
	);
	assert.equal(
		saved.facts.some(
			(fact) => fact.identity === "old-only" && fact.field === "notes",
		),
		false,
	);
});
