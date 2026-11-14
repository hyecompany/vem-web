// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { command, edit } from "../../src/descriptors.js";
import { EditSession } from "../../src/edit.js";
import { createRuntime } from "../../src/runtime.js";
import { createTestClient, deferred } from "../../src/testing.js";
import type {
	ActionOutcome,
	EditBaseline,
	PreparedEdit,
	Values,
} from "../../src/types.js";

type Form = { title: string; secret: string; config: { setting: string } };
const descriptor = edit<Form>({
	resource: "things",
	name: "settings",
	target: "a",
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await tick();
	}
	assert.ok(predicate(), "Expected edit transition did not arrive");
}

function fixture(t: TestContext, initialOutcome?: ActionOutcome) {
	const completion = deferred<ActionOutcome>();
	const state = {
		baseline: {
			title: "Public",
			secret: "Private",
			config: { setting: "original" },
		},
		preparations: 0,
		submissions: [] as Values[],
	};
	const runtime = createRuntime({
		contextId: "alice",
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "write", state: "allowed" },
		],
		resources: [
			{
				name: "things",
				edits: {
					settings: {
						async prepare(input) {
							state.preparations++;
							return {
								descriptor: input,
								values: state.baseline,
								baseline: structuredClone(state.baseline),
								etag: `version-${state.preparations}`,
								disclosure: "public",
								fieldDisclosure: {
									title: "public",
									secret: "read",
									config: "read",
								},
								writeAccess: "write",
								contextId: "",
								accessGeneration: 0,
							};
						},
						command(prepared, values) {
							return command({
								resource: "things",
								name: "save",
								target: prepared.descriptor.target,
								input: { values, etag: prepared.etag },
							});
						},
					},
				},
				commands: {
					save: {
						access: () => "write",
						disclosure: () => "write",
						run(input) {
							state.submissions.push(input.input as Values);
							return initialOutcome
								? Promise.resolve(initialOutcome)
								: completion.promise;
						},
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
	return { runtime, session, state, completion };
}

test("the edit session owns its draft while write access can become read-only", async (t) => {
	const { runtime, session, state } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	state.baseline.config.setting = "external";
	assert.equal(session.getSnapshot().values.config?.setting, "original");
	const replacement = { setting: "local" };
	session.set("config", replacement);
	replacement.setting = "mutated outside the session";
	assert.equal(session.getSnapshot().values.config?.setting, "local");
	assert.equal(session.getSnapshot().dirty, true);
	runtime.revoke("write");
	assert.equal(session.getSnapshot().values.secret, "Private");
	assert.equal(session.getSnapshot().canSave, false);
	assert.throws(() => session.save(), /Write access/);
});

test("uncertain read access quarantines a dirty draft and established denial removes it", async (t) => {
	const { runtime, session, state } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "unsaved private change");
	runtime.setAccess({ decisions: [{ scope: "read", state: "unknown" }] });
	assert.equal(session.getSnapshot().status, "restricted");
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.equal(session.getSnapshot().values.title, "Public");
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(session.getSnapshot().values.secret, "unsaved private change");
	assert.equal(session.getSnapshot().dirty, true);
	runtime.revoke("read");
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.ok(session.getSnapshot().missing.includes("secret"));
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.equal(session.getSnapshot().canSave, false);
	state.baseline.secret = "new authorized baseline";
	await session.reload();
	assert.equal(session.getSnapshot().values.secret, "new authorized baseline");
	assert.equal(session.getSnapshot().dirty, false);
});

test("the first prepared publication admits fields before notifying subscribers", async (t) => {
	const { runtime, session } = fixture(t);
	const observed: unknown[] = [];
	session.subscribe(() => observed.push(session.getSnapshot().values.secret));
	runtime.setAccess({ decisions: [{ scope: "read", state: "unknown" }] });
	await until(() => session.getSnapshot().status === "restricted");
	assert.equal(observed.includes("Private"), false);
	assert.equal(session.getSnapshot().values.title, "Public");
});

test("owner replacement invalidates the old baseline even when grant numbers coincide", async (t) => {
	const { runtime, session } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "old owner's draft");
	const snapshot = runtime.accessSnapshot.bind(runtime);
	runtime.accessSnapshot = () => ({
		...snapshot(),
		epoch: "replacement-owner",
	});
	runtime.setAccess({ decisions: [{ scope: "unrelated", state: "allowed" }] });
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.equal(session.getSnapshot().values.title, "Public");
	assert.equal(session.getSnapshot().canSave, false);
	assert.throws(() => session.save(), /Reload/);
});

test("conflicting, partial and unknown outcomes preserve input and require explicit rebasing", async (t) => {
	const outcomes: ActionOutcome[] = [
		{
			kind: "failed",
			submitted: false,
			error: { code: "conflict", message: "Baseline changed" },
		},
		{ kind: "partial", value: { saved: ["one"] } },
		{ kind: "unknown", message: "Owner lost the response" },
	];
	for (const outcome of outcomes) {
		const { runtime, session } = fixture(t, outcome);
		await until(() => session.getSnapshot().status === "ready");
		session.set("title", "unsaved title");
		await session.save().result;
		await until(() => session.getSnapshot().saving === false);
		assert.equal(session.getSnapshot().values.title, "unsaved title");
		assert.equal(session.getSnapshot().canSave, false);
		runtime.setAccess({
			decisions: [{ scope: "unrelated", state: "allowed" }],
		});
		session.set("title", "another unsaved title");
		assert.deepEqual(session.getSnapshot().outcome, outcome);
		assert.equal(session.getSnapshot().canSave, false);
		assert.equal(session.field("title").canEdit, true);
		assert.throws(() => session.save(), /reload/);
		await session.reload();
		session.set("title", "new edit");
		assert.equal(session.getSnapshot().canSave, true);
	}
});

test("successful saves retain their outcome through automatic rebasing and permit another save", async (t) => {
	const { runtime, session, state, completion } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "First saved value");
	const first = session.save();
	state.baseline.secret = "First saved value";
	completion.resolve({
		kind: "succeeded",
		value: { secret: "Protected success" },
	});
	await first.result;
	await until(
		() => state.preparations === 2 && session.getSnapshot().status === "ready",
	);
	assert.equal(session.getSnapshot().dirty, false);
	assert.equal(session.getSnapshot().values.secret, "First saved value");
	assert.equal(session.getSnapshot().outcome?.kind, "succeeded");
	runtime.setAccess({ decisions: [{ scope: "write", state: "denied" }] });
	runtime.setAccess({ decisions: [{ scope: "write", state: "allowed" }] });
	session.set("secret", "Second saved value");
	assert.equal(session.getSnapshot().outcome, undefined);
	const second = session.save();
	state.baseline.secret = "Second saved value";
	await second.result;
	await until(
		() => state.preparations === 3 && session.getSnapshot().status === "ready",
	);
	assert.equal(session.getSnapshot().values.secret, "Second saved value");
	assert.equal(session.getSnapshot().outcome?.kind, "succeeded");
	runtime.revoke("read");
	assert.equal(session.getSnapshot().outcome, undefined);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	await session.reload();
	assert.equal(session.getSnapshot().outcome, undefined);
});

test("automatic rebasing cannot restore success details withdrawn during preparation", async (t) => {
	const { runtime, session, state, completion } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	const prepared = deferred<PreparedEdit<Form>>();
	const prepare = runtime.prepareEdit.bind(runtime);
	runtime.prepareEdit = (() => prepared.promise) as typeof runtime.prepareEdit;
	session.set("secret", "Saved secret");
	state.baseline.secret = "Saved secret";
	const action = session.save();
	completion.resolve({ kind: "succeeded", value: { secret: "Saved secret" } });
	await action.result;
	await until(() => session.getSnapshot().status === "loading");
	assert.equal(session.getSnapshot().outcome?.kind, "succeeded");
	runtime.revoke("read");
	assert.equal(session.getSnapshot().outcome, undefined);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	prepared.resolve(await prepare(descriptor));
	await until(() => session.getSnapshot().status === "ready");
	assert.equal(session.getSnapshot().values.secret, "Saved secret");
	assert.equal(session.getSnapshot().outcome, undefined);
});

test("a completed save does not overwrite edits entered while it was running", async (t) => {
	const { runtime, session, state, completion } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("title", "submitted title");
	const action = session.save();
	session.set("title", "newer local title");
	await until(() => state.submissions.length === 1);
	assert.equal((state.submissions[0]?.values as Form).title, "submitted title");
	completion.resolve({ kind: "succeeded" });
	await action.result;
	await until(() => !session.getSnapshot().saving);
	assert.equal(session.getSnapshot().values.title, "newer local title");
	assert.equal(state.preparations, 1);
	runtime.setAccess({ decisions: [{ scope: "unrelated", state: "allowed" }] });
	assert.equal(session.getSnapshot().canSave, false);
});

test("disposal fences late save outcomes and releases copied draft values", async (t) => {
	const { session, state, completion } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "pending secret");
	const action = session.save();
	await until(() => state.submissions.length === 1);
	session.dispose();
	completion.resolve({ kind: "succeeded" });
	await action.result;
	await tick();
	assert.deepEqual(session.getSnapshot().values, {});
	assert.equal(session.getSnapshot().outcome, undefined);
	assert.equal(state.preparations, 1);
});

test("a prepared result arriving after disposal cannot restore protected fields", async (t) => {
	const prepared = deferred<EditBaseline>();
	const runtime = createRuntime({
		contextId: "alice",
		access: [{ scope: "read", state: "allowed" }],
		resources: [
			{
				name: "things",
				edits: {
					settings: {
						prepare: () => prepared.promise,
						command: () =>
							command({ resource: "things", name: "unused", input: {} }),
					},
				},
			},
		],
	});
	t.after(() => runtime.close());
	const session = new EditSession(runtime, descriptor);
	session.subscribe(() => undefined);
	session.dispose();
	prepared.resolve({
		descriptor,
		values: { secret: "late secret" },
		baseline: { secret: "late secret" },
		etag: "one",
		disclosure: "public",
		fieldDisclosure: { secret: "read" },
		writeAccess: { all: [] },
	});
	await tick();
	assert.deepEqual(session.getSnapshot().values, {});
});

test("draft construction is inert and the last subscription releases its copy before a fresh attachment", async (t) => {
	const { runtime } = fixture(t);
	let reads = 0;
	let subscriptions = 0;
	const prepare = runtime.prepareEdit.bind(runtime);
	const subscribe = runtime.subscribe.bind(runtime);
	runtime.prepareEdit = (descriptor) => {
		reads++;
		return prepare(descriptor);
	};
	runtime.subscribe = (listener) => {
		subscriptions++;
		const stop = subscribe(listener);
		return () => {
			subscriptions--;
			stop();
		};
	};
	const session = new EditSession(runtime, descriptor);
	assert.equal(reads, 0);
	assert.equal(subscriptions, 0);
	const stopFirst = session.subscribe(() => undefined);
	stopFirst();
	const stopSecond = session.subscribe(() => undefined);
	await until(() => session.getSnapshot().status === "ready");
	assert.equal(reads, 2);
	assert.equal(subscriptions, 1);
	session.set("secret", "first attachment private copy");
	stopSecond();
	assert.deepEqual(session.getSnapshot().values, {});
	assert.equal(subscriptions, 0);
	runtime.revoke("read");
	const observed: unknown[] = [];
	const stopThird = session.subscribe(() =>
		observed.push(session.getSnapshot().values.secret),
	);
	await until(() => session.getSnapshot().status !== "loading");
	assert.equal(observed.includes("first attachment private copy"), false);
	assert.equal(session.getSnapshot().values.secret, undefined);
	stopThird();
	assert.equal(subscriptions, 0);
});

test("retiring an authority forgets its draft fields while public input survives", async (t) => {
	const { runtime, session } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "retired private draft");
	session.set("title", "still public");
	runtime.setAccess({ contextId: "anonymous", decisions: [] });
	assert.equal(session.getSnapshot().values.title, "still public");
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.deepEqual(
		new Set(session.getSnapshot().missing),
		new Set(["secret", "config"]),
	);
	assert.equal(session.getSnapshot().canSave, false);
	runtime.setAccess({
		contextId: "alice",
		decisions: [
			{ scope: "read", state: "allowed" },
			{ scope: "write", state: "allowed" },
		],
	});
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.ok(session.getSnapshot().missing.includes("secret"));
	await session.reload();
	assert.equal(session.getSnapshot().values.secret, "Private");

	// An earlier retirement of the same authority cannot retire a newly prepared draft.
	session.set("secret", "new private draft");
	runtime.setAccess({
		contextId: "discovering",
		retirePrevious: false,
		decisions: [],
	});
	assert.deepEqual(session.getSnapshot().missing, []);
	runtime.setAccess({
		contextId: "alice",
		retirePrevious: false,
		decisions: [{ scope: "read", state: "allowed" }],
	});
	assert.equal(session.getSnapshot().values.secret, "new private draft");
	assert.deepEqual(session.getSnapshot().missing, []);
});

test("retiring another authority does not forget a quarantined draft", async (t) => {
	const { runtime, session } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "quarantined private draft");
	runtime.setAccess({ contextId: "bob", retirePrevious: false, decisions: [] });
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.deepEqual(session.getSnapshot().missing, []);
	runtime.setAccess({ contextId: "carol", decisions: [] });
	assert.deepEqual(session.getSnapshot().missing, []);
	runtime.setAccess({
		contextId: "alice",
		retirePrevious: false,
		decisions: [{ scope: "read", state: "allowed" }],
	});
	assert.equal(
		session.getSnapshot().values.secret,
		"quarantined private draft",
	);
	assert.deepEqual(session.getSnapshot().missing, []);
	assert.equal(session.getSnapshot().canSave, false);
});

test("publications during reload cannot admit new input and still withdraw revoked fields", async (t) => {
	const { runtime, session } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "previous private draft");
	const prepared = deferred<PreparedEdit<Form>>();
	const prepare = runtime.prepareEdit.bind(runtime);
	runtime.prepareEdit = (() => prepared.promise) as typeof runtime.prepareEdit;
	const reload = session.reload();
	runtime.setAccess({ decisions: [{ scope: "unrelated", state: "allowed" }] });
	assert.equal(session.getSnapshot().status, "loading");
	assert.equal(session.getSnapshot().canSave, false);
	assert.throws(
		() => session.set("secret", "input while loading"),
		/not currently editable/,
	);
	assert.throws(() => session.save(), /not ready/);

	runtime.revoke("read");
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.equal(session.getSnapshot().values.title, "Public");
	assert.ok(session.getSnapshot().missing.includes("secret"));
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(session.getSnapshot().canSave, false);
	assert.throws(
		() => session.set("secret", "input after regrant"),
		/not currently editable/,
	);

	prepared.resolve(await prepare(descriptor));
	await reload;
	assert.equal(session.getSnapshot().status, "ready");
	assert.equal(session.getSnapshot().values.secret, "Private");
	assert.equal(session.getSnapshot().dirty, false);
});

test("failed reload remains failed through notifications and save attempts until successful reload", async (t) => {
	const { runtime, session } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("title", "draft");
	const prepare = runtime.prepareEdit.bind(runtime);
	runtime.prepareEdit = async () => {
		throw new Error("reload failed");
	};
	await session.reload();
	runtime.setAccess({ decisions: [{ scope: "unrelated", state: "allowed" }] });
	assert.equal(session.getSnapshot().status, "error");
	assert.equal(session.getSnapshot().reason, "reload failed");
	assert.equal(session.getSnapshot().values.title, "draft");
	assert.equal(session.getSnapshot().canSave, false);
	assert.throws(() => session.save(), /reload failed/);
	runtime.revoke("read");
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.equal(session.getSnapshot().canSave, false);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	runtime.prepareEdit = prepare;
	await session.reload();
	assert.equal(session.getSnapshot().status, "ready");
	assert.equal(session.getSnapshot().reason, undefined);
	session.set("title", "new draft");
	assert.equal(session.getSnapshot().canSave, true);
});

test("field state separates readable optional input, write denial, and undeclared fields", async (t) => {
	const optional = edit<{ title: string; notes?: string }>({
		resource: "notes",
		name: "settings",
		target: "a",
	});
	const scenario = createTestClient({
		edits: [
			{
				edit: optional,
				values: { title: "Title" },
				fields: { notes: "allowed" },
			},
		],
	});
	const session = new EditSession(scenario.client, optional);
	t.after(() => scenario.close());
	t.after(session.subscribe(() => undefined));
	await until(() => session.getSnapshot().status === "ready");
	assert.equal(session.getSnapshot().canSave, false);
	assert.equal(session.getSnapshot().canEdit, true);
	const notes = session.field("notes");
	assert.equal(notes.state, "readable");
	if (notes.state !== "readable")
		throw new Error("Expected an unset readable optional field");
	assert.equal(notes.value, undefined);
	notes.setValue("New notes");
	scenario.setEditAccess(optional, { write: "denied" });
	assert.equal(session.field("notes").canEdit, true);
	assert.equal(session.getSnapshot().canSave, false);
	session.set("notes", "Readable work survives write loss");
	assert.equal(
		session.getSnapshot().values.notes,
		"Readable work survives write loss",
	);
	assert.throws(
		() => session.set("undeclared" as "notes", "secret"),
		/not currently editable/,
	);
	const prepared = await scenario.client.prepareEdit(optional);
	assert.ok(Object.hasOwn(prepared.fieldDisclosure, "notes"));
	assert.throws(
		() =>
			scenario.client.saveEdit(prepared, {
				title: "Title",
				unexpected: "no",
			} as { title: string }),
		/undeclared/,
	);
	scenario.setEditAccess(optional, { fields: { notes: "denied" } });
	assert.equal(session.field("notes").state, "restricted");
	assert.equal(session.getSnapshot().values.notes, undefined);
	scenario.setEditAccess(optional, { fields: { title: "denied" } });
	assert.equal(session.getSnapshot().canEdit, false);
	assert.equal(session.field("title").canEdit, false);
});

test("editing a readable field does not erase another field quarantined by unknown access", async (t) => {
	const { runtime, session } = fixture(t);
	await until(() => session.getSnapshot().status === "ready");
	session.set("secret", "Protected draft");
	runtime.setAccess({ decisions: [{ scope: "read", state: "unknown" }] });
	assert.equal(session.field("secret").state, "restricted");
	assert.equal(session.field("title").canEdit, true);
	session.set("title", "Public draft");
	assert.equal(session.getSnapshot().values.secret, undefined);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(session.getSnapshot().values.secret, "Protected draft");
	assert.equal(session.getSnapshot().values.title, "Public draft");
});
