// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, edit, query, stableKey } from "../../src/descriptors.js";
import { EditSession } from "../../src/edit.js";
import {
	fixtureRows,
	reconcileQueryFixtures,
} from "../../src/testing/query-fixtures.js";
import type { QueryFixtureInput } from "../../src/testing/types.js";
import { createTestClient, deferred } from "../../src/testing.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100 && !predicate(); i++) await tick();
	assert.ok(predicate());
}

test("feature fixtures distinguish denied, failed, loading and incomplete views", async (t) => {
	const selected = (name: string) =>
		query<{ name: string; description: string }>({
			resource: name,
			mode: "list",
			select: ["name", "description"],
		});
	const denied = selected("denied"),
		failed = selected("failed"),
		loading = selected("loading");
	const scenario = createTestClient({
		queries: [
			{ query: denied, status: "denied" },
			{ query: failed, status: "failed", error: "Member unavailable" },
			{ query: loading, status: "loading" },
		],
	});
	t.after(() => scenario.close());
	assert.equal((await scenario.client.read(denied)).issues[0]?.kind, "access");
	assert.equal(
		(await scenario.client.read(failed)).issues[0]?.message,
		"Member unavailable",
	);
	const watch = scenario.client.watch(loading);
	const stop = watch.subscribe(() => undefined);
	t.after(stop);
	await until(() => watch.getSnapshot().fetching);
	assert.equal(watch.getSnapshot().empty, false);
	scenario.setQuery({
		query: loading,
		rows: [{ identity: "a", data: { name: "A" } }],
		complete: false,
	});
	await until(() => watch.getSnapshot().settled);
	assert.equal(watch.getSnapshot().rows[0]?.data.name, "A");
	assert.deepEqual(watch.getSnapshot().rows[0]?.missing, ["description"]);
	assert.equal(watch.getSnapshot().confirmed.complete, false);
	assert.equal(watch.getSnapshot().empty, false);
	scenario.setQuery({
		query: loading,
		status: "failed",
		error: "Disconnected",
	});
	await until(() =>
		watch
			.getSnapshot()
			.issues.some((issue) => issue.message === "Disconnected"),
	);
	scenario.setQuery({ query: loading, status: "denied" });
	await until(() =>
		watch.getSnapshot().issues.some((issue) => issue.kind === "access"),
	);
	assert.equal(watch.getSnapshot().rows.length, 0);
	scenario.setQuery({ query: loading, rows: [], complete: true });
	await until(() => watch.getSnapshot().empty);
});

test("shared fixture changes respect identity, project, replacement fields and partial membership", async (t) => {
	const selected = (project: string, where?: { status: string }) =>
		query<
			{ name: string; status: string; description: string },
			{ project: string; name: string }
		>({
			resource: "instances",
			mode: "list",
			scope: { project },
			select: ["name", "status", "description"],
			where,
		});
	const alpha = selected("alpha"),
		beta = selected("beta"),
		running = selected("alpha", { status: "Running" });
	const one = { project: "alpha", name: "one" },
		two = { project: "alpha", name: "two" },
		other = { project: "beta", name: "one" };
	const scenario = createTestClient({
		scopes: {
			instances: (identity, scope) =>
				(identity as { project: string }).project ===
				(scope as { project: string }).project,
		},
		queries: [
			{
				query: alpha,
				rows: [
					{
						identity: one,
						data: { name: "One", status: "Running", description: "Keep this" },
					},
					{
						identity: two,
						data: {
							name: "Two",
							status: "Stopped",
							description: "Another row",
						},
					},
				],
			},
			{
				query: beta,
				rows: [
					{
						identity: other,
						data: {
							name: "Other project",
							status: "Running",
							description: "Independent",
						},
					},
				],
			},
		],
	});
	t.after(() => scenario.close());
	const alphaHandle = scenario.client.watch(alpha),
		betaHandle = scenario.client.watch(beta);
	t.after(alphaHandle.subscribe(() => undefined));
	t.after(betaHandle.subscribe(() => undefined));
	await until(
		() => alphaHandle.getSnapshot().settled && betaHandle.getSnapshot().settled,
	);
	scenario.setQuery({
		query: running,
		unresolved: [{ identity: one, data: { name: "One" } }],
		replace: ["status"],
		complete: false,
	});
	const filtered = await scenario.client.read(running);
	assert.equal(filtered.rows.length, 0);
	assert.equal(filtered.unresolved.length, 1);
	const all = await scenario.client.read(alpha);
	assert.equal(all.rows.length, 2);
	assert.equal(
		all.rows.find((row) => row.data.name === "One")?.data.description,
		"Keep this",
	);
	assert.equal(
		all.rows.find((row) => row.data.name === "One")?.data.status,
		undefined,
	);
	assert.equal(
		all.rows.find((row) => row.data.name === "Two")?.data.status,
		"Stopped",
	);
	assert.equal(betaHandle.getSnapshot().rows[0]?.data.status, "Running");
	assert.equal(
		betaHandle.getSnapshot().rows[0]?.fields.status?.stale,
		undefined,
	);
	assert.equal(betaHandle.getSnapshot().confirmed.complete, true);
});

test("an explicitly absent detail cannot be resurrected by retrying an older partial list", async (t) => {
	const list = query<{ name: string; description: string }>({
		resource: "tasks",
		mode: "list",
		select: ["name", "description"],
	});
	const detail = query<{ name: string }>({
		resource: "tasks",
		mode: "one",
		identity: "walk",
		select: ["name"],
	});
	const scenario = createTestClient({
		queries: [
			{
				query: list,
				rows: [
					{ identity: "walk", data: { name: "Walk" } },
					{ identity: "picnic", data: { name: "Picnic" } },
				],
				complete: false,
			},
		],
	});
	t.after(() => scenario.close());
	const handle = scenario.client.watch(list);
	t.after(handle.subscribe(() => undefined));
	await until(() => handle.getSnapshot().settled);
	scenario.setQuery({ query: detail, exists: false });
	assert.deepEqual(
		handle.getSnapshot().rows.map((row) => row.data.name),
		["Picnic"],
	);
	await handle.retry();
	assert.deepEqual(
		handle.getSnapshot().rows.map((row) => row.data.name),
		["Picnic"],
	);
	assert.equal(handle.getSnapshot().confirmed.complete, false);
});

test("a simulated identity can leave and reenter a filtered representation without changing its failure state", () => {
	const all = query<{ status: string }>({
		resource: "tasks",
		mode: "list",
		select: ["status"],
	});
	const running = query<{ status: string }>({
		resource: "tasks",
		mode: "list",
		select: ["status"],
		where: { status: "Running" },
	});
	const fixture: QueryFixtureInput = {
		query: running,
		rows: [{ identity: "walk", data: { status: "Running" } }],
		status: "failed",
		error: "Filtered source unavailable",
	};
	const fixtures = new Map([[stableKey(running), fixture]]);
	const candidates = new Map([[stableKey(running), fixtureRows(fixture)]]);
	const update = (status: string | undefined) =>
		reconcileQueryFixtures(
			fixtures,
			candidates,
			{
				query: all,
				rows: [{ identity: "walk", data: status ? { status } : {} }],
				replace: ["status"],
			},
			undefined,
		);
	update("Stopped");
	assert.equal(fixtures.get(stableKey(running))?.rows?.length, 0);
	update("Running");
	assert.equal(fixtures.get(stableKey(running))?.rows?.[0]?.identity, "walk");
	update(undefined);
	assert.equal(fixtures.get(stableKey(running))?.rows?.length, 0);
	assert.equal(
		fixtures.get(stableKey(running))?.unresolved?.[0]?.identity,
		"walk",
	);
	assert.equal(fixtures.get(stableKey(running))?.status, "failed");
	assert.equal(
		fixtures.get(stableKey(running))?.error,
		"Filtered source unavailable",
	);
	update("Running");
	assert.equal(fixtures.get(stableKey(running))?.rows?.[0]?.identity, "walk");
	assert.equal(fixtures.get(stableKey(running))?.unresolved?.length, 0);
});

test("an editor scenario supplies a conflict and field access changes without resource adapter setup", async (t) => {
	type Form = { description: string; secret: string };
	const descriptor = edit<Form>({
		resource: "profiles",
		name: "edit",
		target: { name: "default" },
	});
	const baseline: Form = { description: "Original", secret: "Private" };
	const scenario = createTestClient({
		edits: [{ edit: descriptor, values: baseline, etag: "one" }],
	});
	const session = new EditSession(scenario.client, descriptor);
	const stop = session.subscribe(() => undefined);
	t.after(() => {
		stop();
		scenario.close();
	});
	await until(() => session.getSnapshot().status === "ready");
	session.set("description", "Unsaved change");
	scenario.setEdit({
		edit: descriptor,
		values: { ...baseline, description: "External change" },
		etag: "two",
	});
	assert.equal((await session.save().result).kind, "failed");
	assert.equal(session.getSnapshot().values.description, "Unsaved change");
	assert.equal(session.getSnapshot().canSave, false);
	assert.equal(scenario.saves[0]?.etag, "one");
	assert.equal(scenario.saves[0]?.values.description, "Unsaved change");
	scenario.setEditAccess(descriptor, { fields: { secret: "unknown" } });
	assert.equal(session.getSnapshot().values.secret, undefined);
	scenario.setEditAccess(descriptor, { fields: { secret: "allowed" } });
	assert.equal(session.getSnapshot().values.secret, "Private");
	scenario.setEditAccess(descriptor, { fields: { secret: "denied" } });
	assert.equal(session.getSnapshot().values.description, "Unsaved change");
	assert.equal(session.getSnapshot().values.secret, undefined);
	assert.deepEqual(session.getSnapshot().missing, ["secret"]);
});

test("changing a command scenario publishes current admission to subscribed consumers", (t) => {
	const selected = command({
		resource: "tasks",
		name: "complete",
		target: "walk",
		input: {},
	});
	const scenario = createTestClient({
		commands: [{ command: selected, outcome: { kind: "succeeded" } }],
	});
	t.after(() => scenario.close());
	let availability = scenario.client.availability(selected).state;
	t.after(
		scenario.client.subscribe(() => {
			availability = scenario.client.availability(selected).state;
		}),
	);
	scenario.setOutcome({
		command: selected,
		outcome: { kind: "succeeded" },
		availability: { state: "denied", reason: "Scenario denies completion" },
	});
	assert.equal(availability, "denied");
	scenario.setOutcome({ command: selected, outcome: { kind: "succeeded" } });
	assert.equal(availability, "available");
});

test("test feedback shares inline claims and outcome acknowledgement without acquiring a query", async (t) => {
	const list = query<{ title: string }, string>({
		resource: "tasks",
		mode: "list",
		select: ["title"],
	});
	const operation = command({
		resource: "tasks",
		name: "complete",
		target: "a",
		input: {},
	});
	const completion = deferred<{ kind: "succeeded" }>();
	const scenario = createTestClient({
		queries: [{ query: list, status: "loading" }],
		commands: [{ command: operation, outcome: () => completion.promise }],
	});
	t.after(() => scenario.close());
	const release = scenario.feedback.claimQueryFeedback(list);
	assert.equal(scenario.client.watch(list).getSnapshot().fetching, false);
	const action = scenario.client.run(operation);
	await until(() => action.getSnapshot().phase === "running");
	assert.deepEqual(scenario.client.feedback(), []);
	release();
	assert.deepEqual(scenario.client.feedback(), [action.id]);
	const observed = action.getSnapshot();
	scenario.client.acknowledgeFeedback(action.id, observed);
	assert.deepEqual(scenario.client.feedback(), []);
	completion.resolve({ kind: "succeeded" });
	await action.result;
	await until(() => scenario.client.feedback().includes(action.id));
	scenario.client.acknowledgeFeedback(action.id, observed);
	assert.deepEqual(scenario.client.feedback(), [action.id]);
	scenario.client.acknowledgeFeedback(action.id, action.getSnapshot());
	assert.deepEqual(scenario.client.feedback(), []);
});
