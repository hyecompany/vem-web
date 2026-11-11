// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { defineResource, edit } from "@hyecompany/vem-data";
import {
	createRuntime,
	DexiePersistence,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { deferred, MemoryPersistence } from "@hyecompany/vem-data/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { AccessRegistry, grantKey } from "../../src/access.js";
import { EditSession } from "../../src/edit.js";

const tasks = defineResource<{ title: string; notes: string }, string>()({
	name: "tasks",
	fields: ["title", "notes"],
});
const requirement = {
	all: ["signed-in", { any: ["team", "invite"] }],
} as const;
const access = ["signed-in", "team", "invite"].map((scope) => ({
	scope,
	state: "allowed" as const,
}));
const definition: ResourceDefinition = {
	name: "tasks",
	fieldAccess: { notes: requirement },
	persist: () => true,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("native field policy persists conjunctions and keeps independent alternative permission", async (t) => {
	const persistence = new MemoryPersistence();
	const runtime = createRuntime({
		contextId: "alice",
		access,
		persistence,
		resources: [definition],
	});
	t.after(() => runtime.close());
	await runtime.ready;
	runtime.observe({
		facts: [
			{
				resource: "tasks",
				identity: "walk",
				presence: "present",
				values: { title: "Walk", notes: "Private" },
				basis: ["public"],
			},
		],
	});
	const view = runtime.watch(tasks.get("walk", { select: ["title", "notes"] }));
	t.after(() => view.dispose());
	runtime.revoke("team");
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Private");
	runtime.revoke("signed-in");
	assert.equal(view.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	await runtime.flush();
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.field === "notes"),
		false,
	);
	runtime.setAccess({ decisions: access });
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
});

test("a late response cannot capture regranted field authority", async (t) => {
	const response = deferred<void>();
	const started = deferred<void>();
	let calls = 0;
	const runtime = createRuntime({
		contextId: "alice",
		access,
		resources: [
			{
				...definition,
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["title", "notes"],
						async run(_query, context) {
							const invocation = ++calls;
							const proof = context.proof(requirement);
							started.resolve();
							await response.promise;
							return {
								facts: [
									{
										resource: "tasks",
										identity: "walk",
										values: {
											title: "Walk",
											notes: invocation === 1 ? "Late" : "Current",
										},
										presence: "present",
										basis: ["public"],
										fieldBasis: { notes: [proof] },
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
	const observed: unknown[] = [];
	t.after(
		runtime.subscribe(() => {
			observed.push(
				...runtime
					.readModelSnapshot()
					.records.map((record) => record.confirmed?.values.notes),
			);
		}),
	);
	const result = runtime.read(
		tasks.get("walk", { select: ["title", "notes"] }),
	);
	await started.promise;
	runtime.revoke("signed-in");
	runtime.setAccess({ decisions: [{ scope: "signed-in", state: "allowed" }] });
	response.resolve();
	await result;
	assert.equal(
		runtime
			.readModelSnapshot()
			.records.some((record) => record.confirmed?.values.notes === "Late"),
		false,
	);
	assert.equal(observed.includes("Late"), false);
	assert.equal(calls, 2);
	assert.ok(
		runtime
			.readModelSnapshot()
			.records.some((record) => record.confirmed?.values.notes === "Current"),
	);
});

test("native field access withdraws dirty editor values and invalidates its baseline", async (t) => {
	const descriptor = edit<{ title: string; notes: string }>({
		resource: "tasks",
		name: "notes",
		target: "walk",
	});
	const runtime = createRuntime({
		contextId: "alice",
		access,
		resources: [
			{
				...definition,
				edits: {
					notes: {
						async prepare(input) {
							return {
								descriptor: input,
								values: { title: "Walk", notes: "Original" },
								etag: "one",
								baseline: { notes: "Original" },
								disclosure: "public",
								fieldDisclosure: { title: "public", notes: "public" },
								writeAccess: "public",
							};
						},
						command: () => ({
							kind: "command",
							resource: "tasks",
							name: "save",
							input: {},
						}),
					},
				},
			},
		],
	});
	const session = new EditSession(runtime, descriptor);
	const stop = session.subscribe(() => undefined);
	t.after(() => {
		stop();
		session.dispose();
		runtime.close();
	});
	for (
		let attempt = 0;
		session.getSnapshot().status === "loading" && attempt < 30;
		attempt++
	)
		await tick();
	assert.equal(session.getSnapshot().status, "ready");
	session.set("notes", "Dirty draft");
	runtime.revoke("signed-in");
	assert.equal(session.getSnapshot().values.notes, undefined);
	assert.equal(session.getSnapshot().values.title, "Walk");
	assert.equal(session.getSnapshot().canSave, false);
	runtime.setAccess({ decisions: access });
	assert.equal(session.getSnapshot().values.notes, undefined);
});

test("Dexie retirement blocks late writes with a conjunctive proof while preserving alternatives", async (t) => {
	const persistence = new DexiePersistence(`proof-${crypto.randomUUID()}`, {
		indexedDB,
		IDBKeyRange,
	});
	const runtime = createRuntime({
		contextId: "alice",
		access,
		persistence,
		resources: [definition],
	});
	t.after(() => {
		runtime.close();
		persistence.close();
	});
	await runtime.ready;
	runtime.observe({
		facts: [
			{
				resource: "tasks",
				identity: "walk",
				presence: "present",
				values: { title: "Walk", notes: "Private" },
				basis: ["public"],
			},
		],
	});
	await runtime.flush();
	const before = (await persistence.load()).facts;
	runtime.revoke("team");
	await runtime.flush();
	assert.equal(
		(await persistence.load()).facts.some((fact) => fact.field === "notes"),
		true,
	);
	runtime.revoke("signed-in");
	await runtime.flush();
	await persistence.writeFacts(
		before.map((fact) => ({ ...fact, revision: fact.revision + 1000 })),
		[],
	);
	const after = (await persistence.load()).facts;
	assert.equal(
		after.some((fact) => fact.field === "notes"),
		false,
	);
	assert.equal(
		after.some((fact) => fact.field === "title"),
		true,
	);
});

test("restoring a durable denial cannot mint a reusable permission generation", () => {
	const grants = new AccessRegistry("alice", [
		{ scope: "notes", state: "denied" },
	]);
	const denied = grants.ref("notes");
	grants.restoreTombstones({ [grantKey(denied)]: denied.generation });
	const duringDenial = grants.ref("notes");
	assert.equal(grants.revoked(duringDenial), true);
	grants.apply({ decisions: [{ scope: "notes", state: "allowed" }] });
	assert.equal(grants.revoked(duringDenial), true);
	assert.equal(grants.visible(grants.ref("notes")), true);
});

test("one response atomically establishes composite grants and their dependent facts", async (t) => {
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					{
						key: "verified-reference",
						mode: "one",
						fields: ["notes"],
						async run() {
							return {
								grants: [
									{ scope: "parent:view", state: "allowed" },
									{ scope: "target:view", state: "allowed" },
								],
								facts: [
									{
										resource: "tasks",
										identity: "walk",
										presence: "present",
										values: { notes: "Verified reference" },
										basis: [{ all: ["parent:view", "target:view"] }],
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
	const publications: Array<{ allowed: boolean; notes: unknown }> = [];
	const stop = runtime.subscribe(() =>
		publications.push({
			allowed: runtime.access("target:view") === "allowed",
			notes: runtime.readModelSnapshot().records[0]?.confirmed?.values.notes,
		}),
	);
	t.after(stop);
	const result = await runtime.read(tasks.get("walk", { select: ["notes"] }));
	assert.equal(result.rows[0]?.data.notes, "Verified reference");
	assert.equal(
		publications.some((value) => value.allowed && value.notes === undefined),
		false,
	);
	runtime.revoke("target:view");
	assert.equal(
		runtime
			.readModelSnapshot()
			.records.some((record) => record.confirmed?.values.notes !== undefined),
		false,
	);
});

test("late hydration registration preserves a freshly re-established grant after caller retirement", () => {
	const grants = new AccessRegistry("alice", [
		{ scope: "notes", state: "allowed" },
	]);
	const retired = grants.ref("notes");
	grants.apply({ contextId: "anonymous", decisions: [] });
	grants.apply({
		contextId: "alice",
		decisions: [{ scope: "notes", state: "allowed" }],
	});
	const current = grants.ref("notes");
	assert.equal(grants.register([current]).length, 0);
	assert.equal(grants.visible(current), true);
	assert.equal(grants.register([retired]).length, 1);
	assert.equal(grants.visible(current), true);
	assert.equal(grants.revoked(retired), true);
});
