// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	defineCommand,
	defineEdit,
	defineResource,
} from "../../src/contracts.js";
import {
	createScenarioClient,
	defineScenarios,
	inspectClient,
} from "../../src/devtools.js";
import { EditSession } from "../../src/edit.js";
import { queryView } from "../../src/react.js";
import { createRuntime } from "../../src/runtime.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await tick();
	assert.ok(predicate());
}
type Widget = { name: string; status: string; description: string };
type Settings = { description: string; secret: string };
const widgets = defineResource<Widget, string>()({
	name: "widgets",
	fields: ["name", "status", "description"],
	commands: { start: defineCommand() },
	edits: { settings: defineEdit<Settings>() },
});
const resource = defineScenarios(widgets, {
	example: {
		identity: "one",
		data: { name: "One", status: "Stopped", description: "A widget" },
	},
	fields: { status: { choices: ["Stopped", "Running"] } },
	commands: {
		start: {
			proposals: [
				{
					resource: "widgets",
					identity: "one",
					kind: "update",
					values: { status: "Starting" },
				},
			],
		},
	},
	edits: {
		settings: { values: { description: "Original", secret: "Protected" } },
	},
});

test("scenario and inspection wrappers preserve passive observation without synthesizing acquisition", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const selected = widgets.list({ select: ["name"] });
	const passive = scenario.client.watch(selected, { acquire: false });
	passive.subscribe(() => {});
	const status = scenario.client.watchReadStatus(selected);
	status.subscribe(() => {});
	await tick();
	assert.equal(passive.getSnapshot().rows.length, 0);
	assert.equal(passive.getSnapshot().settled, true);
	assert.equal(status.getSnapshot().pending, false);
	const active = scenario.client.watch(selected);
	const release = active.subscribe(() => {});
	await until(() => passive.getSnapshot().rows.length > 0);
	release();
	assert.equal(passive.getSnapshot().rows[0]?.data.name, "One");
	passive.dispose();
	status.dispose();
});

test("inspection discovers only consumed watches and adds no acquisition or owner operations", async (t) => {
	let requests = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "widgets",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name"],
						membership: true,
						run: async () => {
							requests++;
							return {
								facts: [
									{
										resource: "widgets",
										identity: "one",
										presence: "present",
										basis: ["public"],
										values: { name: "One" },
									},
								],
								memberships: [
									{
										resource: "widgets",
										identities: ["one"],
										complete: true,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
			},
		],
	});
	const inspector = inspectClient(runtime);
	t.after(() => {
		inspector.close();
		runtime.close();
	});
	const descriptor = widgets.list({ select: ["name"] });
	const first = inspector.client.watch(descriptor);
	assert.equal(requests, 0);
	assert.equal(inspector.getSnapshot().queries.length, 0);
	const stopFirst = first.subscribe(() => undefined);
	await until(() => first.getSnapshot().settled);
	assert.equal(requests, 1);
	const second = inspector.client.watch(widgets.list({ select: ["name"] }));
	const stopSecond = second.subscribe(() => undefined);
	assert.equal(inspector.getSnapshot().queries.length, 1);
	assert.equal(inspector.getSnapshot().queries[0]?.subscribers, 2);
	assert.equal(requests, 1);
	stopSecond();
	stopSecond();
	second.dispose();
	assert.equal(inspector.getSnapshot().queries[0]?.subscribers, 1);
	runtime.observe({
		facts: [
			{
				resource: "widgets",
				identity: "one",
				values: { name: "Updated" },
				basis: ["public"],
			},
		],
	});
	assert.equal(
		inspector.getSnapshot().queries[0]?.result?.rows[0]?.data.name,
		"Updated",
	);
	first.dispose();
	stopFirst();
	assert.equal(inspector.getSnapshot().queries[0]?.result, undefined);
	const third = inspector.client.watch(descriptor);
	const stopThird = third.subscribe(() => undefined);
	assert.equal(inspector.getSnapshot().queries[0]?.subscribers, 1);
	assert.equal(third.getSnapshot().rows[0]?.data.name, "Updated");
	stopThird();
	third.dispose();
	assert.equal(requests, 1);
});

test("isolated scenarios use runtime knowledge for repeated partial, empty, failed, denied and delayed transitions", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const handle = scenario.client.watch(widgets.list());
	const stop = handle.subscribe(() => undefined);
	t.after(stop);
	await until(() => handle.getSnapshot().settled);
	const id = scenario.getSnapshot().queries[0]?.id;
	assert.ok(id);
	assert.equal(handle.getSnapshot().rows[0]?.data.description, "A widget");
	scenario.setQuery(id, { state: "partial", missing: ["description"] });
	await until(() => handle.getSnapshot().settled);
	assert.equal(handle.getSnapshot().rows[0]?.data.description, undefined);
	assert.deepEqual(handle.getSnapshot().rows[0]?.missing, ["description"]);
	assert.equal(handle.getSnapshot().confirmed.complete, false);
	scenario.setQuery(id, { state: "empty" });
	await until(() => handle.getSnapshot().empty);
	assert.equal(handle.getSnapshot().rows.length, 0);
	scenario.setQuery(id, { state: "loading" });
	await until(() => handle.getSnapshot().fetching);
	assert.equal(handle.getSnapshot().stale, false);
	assert.equal(handle.getSnapshot().revalidating, false);
	assert.equal(queryView(handle.getSnapshot()), "loading");
	scenario.setQuery(id, { state: "ready" });
	await until(() => handle.getSnapshot().rows.length === 1);
	scenario.setQuery(id, {
		state: "failed",
		message: "A simulated member failed",
	});
	await until(() =>
		handle.getSnapshot().issues.some((issue) => issue.kind === "read"),
	);
	assert.equal(handle.getSnapshot().rows[0]?.data.name, "One");
	scenario.setQuery(id, { state: "denied" });
	assert.equal(handle.getSnapshot().rows.length, 0);
	assert.equal(scenario.getSnapshot().queries[0]?.result?.rows.length, 0);
	scenario.setQuery(id, { state: "ready" });
	await until(() => handle.getSnapshot().rows.length === 1);
	scenario.setQuery(id, { state: "loading", delayMs: 1 });
	assert.equal(handle.getSnapshot().empty, false);
	await new Promise<void>((resolve) => setTimeout(resolve, 5));
	await until(
		() =>
			handle.getSnapshot().rows.length === 1 && handle.getSnapshot().settled,
	);
	assert.equal(handle.getSnapshot().confirmed.complete, true);
	scenario.setQuery(id, {
		state: "ready",
		values: { description: "Changed in the panel" },
	});
	assert.equal(
		handle.getSnapshot().rows[0]?.data.description,
		"Changed in the panel",
	);
	scenario.setQuery(id, { state: "failed" });
	assert.equal(
		handle.getSnapshot().rows[0]?.data.description,
		"Changed in the panel",
	);
	assert.throws(
		() =>
			scenario.setQuery(id, {
				state: "ready",
				values: { missingField: "wrong" },
			}),
		/Unknown widgets scenario field/,
	);
	assert.equal(
		handle.getSnapshot().rows[0]?.data.description,
		"Changed in the panel",
	);
});

test("a missing filter field produces an unresolved candidate, never an established match", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const handle = scenario.client.watch(
		widgets.list({ where: { status: "Stopped" } }),
	);
	const stop = handle.subscribe(() => undefined);
	t.after(stop);
	const id = scenario.getSnapshot().queries[0]?.id;
	assert.ok(id);
	scenario.setQuery(id, { state: "partial", missing: ["status"] });
	await until(() => handle.getSnapshot().settled);
	assert.equal(handle.getSnapshot().rows.length, 0);
	assert.equal(handle.getSnapshot().unresolved.length, 1);
	assert.equal(handle.getSnapshot().unresolved[0]?.data.name, "One");
	assert.equal(handle.getSnapshot().empty, false);
});

test("overlapping query scenarios cannot reacquire values removed from their shared resource", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const all = scenario.client.watch(widgets.list());
	const stopAll = all.subscribe(() => undefined);
	await until(() => all.getSnapshot().settled);
	const allId = scenario.getSnapshot().queries[0]?.id;
	assert.ok(allId);
	scenario.setQuery(allId, { state: "ready", values: { status: "Running" } });
	await until(() => all.getSnapshot().settled);
	stopAll();
	const running = scenario.client.watch(
		widgets.list({ where: { status: "Running" } }),
	);
	const stopRunning = running.subscribe(() => undefined);
	t.after(stopRunning);
	const filteredId = scenario
		.getSnapshot()
		.queries.find((entry) => entry.subscribers === 1)?.id;
	assert.ok(filteredId);
	scenario.setQuery(filteredId, { state: "partial", missing: ["status"] });
	await until(() => running.getSnapshot().settled);
	assert.equal(running.getSnapshot().rows.length, 0);
	assert.equal(running.getSnapshot().unresolved.length, 1);
	assert.equal(running.getSnapshot().unresolved[0]?.data.status, undefined);
	const resumeAll = all.subscribe(() => undefined);
	t.after(resumeAll);
	await until(() => all.getSnapshot().settled);
	assert.equal(all.getSnapshot().rows[0]?.data.status, undefined);
	assert.equal(running.getSnapshot().unresolved.length, 1);
});

test("discovered commands preserve proposals, progress, outcomes and feedback ownership in the isolated runtime", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const descriptor = widgets.list();
	const query = scenario.client.watch(descriptor);
	const stopQuery = query.subscribe(() => undefined);
	t.after(stopQuery);
	const command = widgets.commands.start("one");
	const availability = scenario.client.watchAvailability(command);
	const stopAvailability = availability.subscribe(() => undefined);
	t.after(stopAvailability);
	const id = scenario.getSnapshot().commands[0]?.id;
	assert.ok(id);
	scenario.setCommand(id, {
		availability: { state: "denied", reason: "Simulated policy" },
	});
	assert.equal(availability.getSnapshot().state, "denied");
	assert.equal((await scenario.client.run(command).result).kind, "failed");
	scenario.setCommand(id, {
		availability: { state: "available" },
		pending: true,
	});
	const releaseInline = scenario.feedback.claimQuery(descriptor);
	const action = scenario.client.run(command);
	await until(() => action.getSnapshot().phase === "running");
	assert.equal(scenario.canAdvance(action.id), true);
	assert.equal(query.getSnapshot().rows[0]?.data.status, "Starting");
	assert.equal(scenario.feedback.getSnapshot().includes(action.id), false);
	scenario.progress(action.id, {
		completed: 2,
		total: 3,
		message: "Preparing widget",
	});
	assert.equal(action.getSnapshot().progress?.completed, 2);
	releaseInline();
	assert.ok(scenario.feedback.getSnapshot().includes(action.id));
	scenario.feedback.acknowledge(action.id);
	assert.equal(scenario.feedback.getSnapshot().includes(action.id), false);
	scenario.settle(action.id, {
		kind: "partial",
		value: { saved: true },
		message: "One downstream target failed",
	});
	assert.equal((await action.result).kind, "partial");
	assert.equal(scenario.canAdvance(action.id), false);
	assert.equal(scenario.progress(action.id, { completed: 99 }), false);
	assert.equal(scenario.settle(action.id, { kind: "succeeded" }), false);
	await until(() => scenario.feedback.getSnapshot().includes(action.id));
	assert.equal(query.getSnapshot().rows[0]?.data.status, "Stopped");
	scenario.feedback.acknowledge(action.id, { phase: "running" });
	assert.ok(scenario.feedback.getSnapshot().includes(action.id));
});

test("editor controls use the real protected session and conditional write baseline", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	const session = new EditSession(
		scenario.client,
		widgets.edits.settings("one"),
	);
	const stop = session.subscribe(() => undefined);
	t.after(() => {
		stop();
		scenario.close();
	});
	await until(() => session.getSnapshot().status === "ready");
	const id = scenario.getSnapshot().edits[0]?.id;
	assert.ok(id);
	assert.equal("values" in (scenario.getSnapshot().edits[0] ?? {}), false);
	session.set("description", "Unsaved input");
	scenario.setEdit(id, { externalChange: true });
	assert.equal(session.getSnapshot().values.description, "Unsaved input");
	const conflict = await session.save().result;
	assert.equal(conflict.kind, "failed");
	if (conflict.kind === "failed") assert.equal(conflict.error.code, "conflict");
	await session.reload();
	session.set("description", "Readable draft");
	scenario.setEdit(id, { write: "denied" });
	assert.equal(session.getSnapshot().canSave, false);
	assert.equal(session.getSnapshot().values.description, "Readable draft");
	scenario.setEdit(id, { write: "allowed" });
	assert.equal(session.getSnapshot().canSave, true);
	scenario.setEdit(id, { fields: { secret: "denied" } });
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.equal(session.getSnapshot().values.description, "Readable draft");
	scenario.setEdit(id, { fields: { secret: "allowed" } });
	assert.equal(session.getSnapshot().values.secret, undefined);
	await session.reload();
	assert.equal(session.getSnapshot().values.secret, "Protected");
	session.set("description", "Committed draft");
	assert.equal((await session.save().result).kind, "succeeded");
	await until(
		() =>
			session.getSnapshot().status === "ready" && !session.getSnapshot().dirty,
	);
	assert.equal(session.getSnapshot().outcome?.kind, "succeeded");
	scenario.setEdit(id, { write: "denied" });
	scenario.setEdit(id, { write: "allowed" });
	session.set("description", "Second committed draft");
	assert.equal((await session.save().result).kind, "succeeded");
});

test("project scoped consumers own inline feedback until their section leaves", async (t) => {
	type Ref = { project: string; name: string };
	const scoped = defineResource<Widget, Ref, { project: string }>()({
		name: "scoped",
		fields: ["name", "status", "description"],
		defaultScope: { project: "default" },
		scopeOf: (identity) => ({ project: identity.project }),
		commands: { state: defineCommand<{ action: "start" | "stop" }>() },
	});
	const target = { project: "default", name: "one" };
	const resource = defineScenarios(scoped, {
		example: {
			identity: target,
			scope: { project: "default" },
			data: { name: "One", status: "Stopped", description: "Scoped" },
		},
		commands: {
			state: {
				proposals: (command) => [
					{
						resource: "scoped",
						identity: command.target,
						kind: "update",
						values: {
							status: command.input.action === "start" ? "Running" : "Stopped",
						},
					},
				],
			},
		},
	});
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const descriptor = scoped.list({ scope: { project: "default" } });
	const handle = scenario.client.watch(descriptor);
	const stop = handle.subscribe(() => undefined);
	t.after(stop);
	const command = scoped.commands.state(target, { action: "start" });
	const availability = scenario.client.watchAvailability(command);
	const stopAvailability = availability.subscribe(() => undefined);
	t.after(stopAvailability);
	const id = scenario.getSnapshot().commands[0]?.id;
	assert.ok(id);
	assert.deepEqual(scenario.getSnapshot().commands[0]?.descriptor.input, {
		action: "start",
	});
	scenario.setCommand(id, { pending: true });
	const releaseInline = scenario.feedback.claimQuery(descriptor);
	const action = scenario.client.run(command);
	await until(() => action.getSnapshot().phase === "running");
	assert.ok(
		handle
			.getSnapshot()
			.activities.some((activity) => activity.id === action.id),
	);
	assert.equal(handle.getSnapshot().rows[0]?.data.status, "Running");
	assert.equal(scenario.feedback.getSnapshot().includes(action.id), false);
	releaseInline();
	assert.ok(scenario.feedback.getSnapshot().includes(action.id));
	scenario.settle(action.id, { kind: "succeeded" });
	await action.result;
});

test("aggregate scopes require a domain predicate and unsupported scenario commands keep their explanation", async (t) => {
	type Ref = { project: string; name: string };
	type Scope = { project?: string; all?: true };
	const scoped = defineResource<Widget, Ref, Scope>()({
		name: "scoped",
		fields: ["name", "status", "description"],
		scopeOf: (identity) => ({ project: identity.project }),
		commands: { retire: defineCommand() },
	});
	const sample = {
		example: {
			identity: { project: "default", name: "one" },
			data: { name: "One", status: "Stopped", description: "Scoped" },
		},
		commands: {
			retire: {
				availability: {
					state: "unsupported" as const,
					reason: "Use permission controls in the isolated scenario",
				},
			},
		},
	};
	const unknown = createScenarioClient({
		resources: [defineScenarios(scoped, sample)],
	});
	t.after(() => unknown.close());
	const query = scoped.list({ scope: { all: true } });
	const unresolved = await unknown.client.read(query);
	assert.equal(unresolved.rows.length, 0);
	assert.equal(unresolved.unresolved.length, 1);
	assert.equal(unresolved.confirmed.complete, false);
	assert.match(unresolved.issues[0]?.message ?? "", /inScope/);
	const known = createScenarioClient({
		resources: [
			defineScenarios(scoped, {
				...sample,
				inScope: (identity, scope) =>
					scope.all === true || identity.project === scope.project,
			}),
		],
	});
	t.after(() => known.close());
	const result = await known.client.read(query);
	assert.equal(result.rows[0]?.data.name, "One");
	assert.equal(result.confirmed.complete, true);
	const command = scoped.commands.retire(sample.example.identity);
	assert.equal(known.client.availability(command).state, "unsupported");
	assert.match(
		known.client.availability(command).reason ?? "",
		/permission controls/,
	);
	assert.equal((await known.client.run(command).result).kind, "failed");
});

test("scenario watch construction is inert and subscription seeds only once across replay", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	await tick();
	const notified = { runtime: 0, activities: 0, inspector: 0, feedback: 0 };
	t.after(scenario.client.subscribe(() => notified.runtime++));
	t.after(scenario.client.subscribeActivities(() => notified.activities++));
	t.after(scenario.subscribe(() => notified.inspector++));
	t.after(scenario.feedback.subscribe(() => notified.feedback++));
	const before = scenario.client.accessSnapshot();
	const descriptor = widgets.list({ select: ["name"] });
	const handle = scenario.client.watch(descriptor);
	handle.getSnapshot();
	await tick();
	assert.deepEqual(notified, {
		runtime: 0,
		activities: 0,
		inspector: 0,
		feedback: 0,
	});
	assert.equal(scenario.client.accessSnapshot(), before);
	assert.equal(scenario.getSnapshot().queries.length, 0);
	const stop = handle.subscribe(() => undefined);
	await until(() => handle.getSnapshot().settled);
	assert.equal(handle.getSnapshot().rows[0]?.data.name, "One");
	const id = scenario.getSnapshot().queries[0]?.id;
	assert.ok(id);
	scenario.setQuery(id, {
		state: "ready",
		values: { name: "Selected scenario" },
	});
	await until(() => handle.getSnapshot().settled);
	stop();
	const replay = handle.subscribe(() => undefined);
	t.after(replay);
	const second = scenario.client.watch(descriptor);
	assert.equal(second.getSnapshot().rows[0]?.data.name, "Selected scenario");
	const secondStop = second.subscribe(() => undefined);
	t.after(secondStop);
	assert.equal(handle.getSnapshot().rows[0]?.data.name, "Selected scenario");
	assert.equal(second.getSnapshot().rows[0]?.data.name, "Selected scenario");
});

test("a configured failure survives disposing and reopening an inline query", async (t) => {
	const scenario = createScenarioClient({ resources: [resource] });
	t.after(() => scenario.close());
	const first = scenario.client.watch(widgets.list({ select: ["name"] }));
	const release = first.subscribe(() => undefined);
	await until(() => first.getSnapshot().settled);
	const id = scenario.getSnapshot().queries[0]?.id;
	assert.ok(id);
	release();
	first.dispose();
	scenario.setQuery(id, { state: "failed", message: "Failed while closed" });
	const second = scenario.client.watch(widgets.list({ select: ["name"] }));
	const stop = second.subscribe(() => undefined);
	t.after(stop);
	await until(() => second.getSnapshot().settled);
	assert.equal(second.getSnapshot().issues[0]?.message, "Failed while closed");
	assert.equal(second.getSnapshot().confirmed.complete, false);
});
