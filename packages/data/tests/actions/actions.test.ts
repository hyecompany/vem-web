// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ActionOutcome } from "../../src/types.js";

import { fact, list, options, resource, tick } from "../support/scenario.js";

test("pending field overlays preserve independent server changes and confirmed counts", async () => {
	const outcome = deferred<ActionOutcome>();
	const runtime = createRuntime(
		options(
			resource({
				commands: {
					rename: {
						access: () => "read",
						disclosure: () => "read",
						project: (cmd) => [
							{
								resource: "things",
								identity: cmd.target,
								values: { name: "Pending" },
								kind: "update",
								basis: ["read"],
							},
						],
						run: () => outcome.promise,
					},
				},
			}),
		),
	);
	runtime.observe({
		facts: [fact("a", { name: "Original", status: "stopped" })],
		memberships: [
			{
				resource: "things",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const handle = runtime.watch(list);
	const action = runtime.run(
		command({ resource: "things", name: "rename", target: "a", input: {} }),
	);
	runtime.observe({ facts: [fact("a", { status: "running" })] });
	assert.deepEqual(handle.getSnapshot().rows[0]?.data, {
		name: "Pending",
		status: "running",
	});
	assert.equal(handle.getSnapshot().confirmed.total, 1);
	outcome.resolve({
		kind: "failed",
		error: { message: "No" },
		submitted: false,
	});
	await action.result;
	assert.deepEqual(handle.getSnapshot().rows[0]?.data, {
		name: "Original",
		status: "running",
	});
	assert.equal(action.getSnapshot().controls.canRetry, true);
	runtime.close();
});

test("auto-named proposals bind without claiming a confirmed count or duplicating rows", async () => {
	const outcome = deferred<ActionOutcome>();
	let bind!: (resource: string, identity: unknown) => void;
	const runtime = createRuntime(
		options(
			resource({
				commands: {
					create: {
						access: () => "read",
						disclosure: () => "read",
						project: () => [
							{
								resource: "things",
								values: { name: "Preparing" },
								kind: "create",
								basis: ["read"],
							},
						],
						run: (_command, action) => {
							bind = action.bind;
							return outcome.promise;
						},
					},
				},
			}),
		),
	);
	runtime.observe({
		memberships: [
			{ resource: "things", identities: [], complete: true, basis: ["read"] },
		],
	});
	const watch = runtime.watch(list);
	const action = runtime.run(
		command({ resource: "things", name: "create", input: {} }),
	);
	await tick();
	const key = watch.getSnapshot().rows[0]?.key;
	assert.equal(watch.getSnapshot().confirmed.total, 0);
	bind("things", "server-name");
	runtime.observe({
		facts: [fact("server-name", { name: "Server", status: "ready" })],
	});
	assert.equal(watch.getSnapshot().rows.length, 1);
	assert.equal(watch.getSnapshot().rows[0]?.key, key);
	assert.equal(watch.getSnapshot().rows[0]?.data.name, "Server");
	outcome.resolve({ kind: "succeeded" });
	await action.result;
	assert.equal(watch.getSnapshot().rows[0]?.key, key);
	assert.equal(watch.getSnapshot().rows[0]?.identity.kind, "resource");
	runtime.close();
});

test("unknown write permission permits an explicit attempt and Blob admission deduplicates", async () => {
	let calls = 0;
	const runtime = createRuntime(
		options(
			resource({
				commands: {
					upload: {
						access: () => "write",
						disclosure: () => "read",
						run: async () => {
							calls++;
							return { kind: "succeeded" };
						},
					},
				},
			}),
		),
	);
	const descriptor = command({
		resource: "things",
		name: "upload",
		input: { file: new Blob(["data"]), transferId: "transfer-1" },
	});
	assert.equal(runtime.availability(descriptor).state, "unknown");
	const first = runtime.run(descriptor, { id: "action-1" });
	const duplicate = runtime.run(structuredClone(descriptor), {
		id: "action-1",
	});
	await first.result;
	await duplicate.result;
	assert.equal(calls, 1);
	runtime.close();
});

test("settled activity retention cannot allow an old admitted ID to dispatch again", async () => {
	let calls = 0;
	const runtime = createRuntime({
		...options(
			resource({
				commands: {
					go: {
						access: () => "read",
						disclosure: () => "read",
						run: async () => {
							calls++;
							return { kind: "succeeded" };
						},
					},
				},
			}),
		),
		maxSettledActions: 3,
	});
	const descriptor = command({ resource: "things", name: "go", input: {} });
	for (let index = 0; index < 10; index++)
		await runtime.run(descriptor, { id: `action-${index}` }).result;
	assert.equal(runtime.listActivities().length, 3);
	assert.throws(
		() => runtime.run(descriptor, { id: "action-0" }),
		/already admitted/,
	);
	assert.equal(calls, 10);
	runtime.close();
});

test("inline activities require an established association with the query scope", async () => {
	const result = deferred<ActionOutcome>();
	const runtime = createRuntime(
		options(
			resource({
				inScope: (identity, scope) =>
					(identity as { project: string }).project ===
					(scope as { project: string }).project,
				commands: {
					create: {
						access: () => "read",
						disclosure: () => "read",
						project: () => [
							{
								resource: "things",
								requested: { project: "one" },
								kind: "create",
								values: { name: "Pending" },
								basis: ["read"],
							},
						],
						run: () => result.promise,
					},
				},
			}),
		),
	);
	const one = runtime.watch({ ...list, scope: { project: "one" } });
	const two = runtime.watch({ ...list, scope: { project: "two" } });
	const action = runtime.run(
		command({ resource: "things", name: "create", input: {} }),
	);
	assert.equal(one.getSnapshot().activities.length, 1);
	assert.equal(two.getSnapshot().activities.length, 0);
	result.resolve({
		kind: "failed",
		error: { message: "Denied" },
		submitted: false,
	});
	await action.result;
	runtime.close();
});

test("inline activities use permitted current scope facts and proposals", async () => {
	const completion = deferred<ActionOutcome>();
	const runtime = createRuntime({
		...options(
			resource({
				inScope: (_identity, scope, values) =>
					typeof values.location === "string"
						? values.location === (scope as { target: string }).target
						: "unknown",
				commands: {
					update: {
						access: () => "act",
						disclosure: () => "act",
						run: () => completion.promise,
					},
					create: {
						access: () => "act",
						disclosure: () => "act",
						project: () => [
							{
								resource: "things",
								kind: "create",
								values: { name: "Pending", location: "two" },
								basis: ["read"],
							},
						],
						run: () => completion.promise,
					},
				},
			}),
		),
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "act", state: "allowed" },
		],
	});
	runtime.observe({
		facts: [
			fact("a", { name: "Known", location: "one" }),
			fact("b", { name: "Unplaced" }),
		],
	});
	const one = runtime.watch({ ...list, scope: { target: "one" } });
	const two = runtime.watch({ ...list, scope: { target: "two" } });
	const update = runtime.run(
		command({ resource: "things", name: "update", target: "a", input: {} }),
	);
	const unplaced = runtime.run(
		command({ resource: "things", name: "update", target: "b", input: {} }),
	);
	const create = runtime.run(
		command({ resource: "things", name: "create", input: {} }),
	);
	assert.deepEqual(
		one.getSnapshot().activities.map((action) => action.id),
		[update.id],
	);
	assert.deepEqual(
		two.getSnapshot().activities.map((action) => action.id),
		[create.id],
	);
	assert.equal(two.getSnapshot().confirmed.knownCount, 0);
	runtime.observe({
		memberships: [
			{
				resource: "things",
				scope: { target: "one" },
				identities: ["b"],
				complete: false,
				basis: ["read"],
			},
		],
	});
	assert.deepEqual(
		one.getSnapshot().activities.map((action) => action.id),
		[update.id, unplaced.id],
	);
	runtime.observe({
		invalidate: [
			{ resource: "things", identity: "a", field: "location" },
			{ resource: "things", identity: "b", field: "$presence" },
		],
	});
	assert.equal(one.getSnapshot().activities.length, 0);
	runtime.observe({ facts: [fact("a", { location: "one" })] });
	assert.equal(one.getSnapshot().activities[0]?.id, update.id);
	runtime.setAccess({ decisions: [{ scope: "read", state: "denied" }] });
	assert.equal(runtime.listActivities().length, 3);
	assert.equal(one.getSnapshot().activities.length, 0);
	assert.equal(two.getSnapshot().activities.length, 0);
	completion.resolve({ kind: "succeeded" });
	await Promise.all([update.result, unplaced.result, create.result]);
	runtime.close();
});

test("submission concurrency is bounded while acknowledged operations keep running", async () => {
	const acknowledgements = Array.from({ length: 3 }, () => deferred<void>());
	const completion = deferred<ActionOutcome>();
	let submitted = 0,
		concurrent = 0,
		peak = 0;
	const runtime = createRuntime({
		...options(
			resource({
				commands: {
					go: {
						access: () => "read",
						disclosure: () => "read",
						run: async (_command, context) => {
							const index = submitted++;
							concurrent++;
							peak = Math.max(peak, concurrent);
							await acknowledgements[index]?.promise;
							concurrent--;
							context.submitted();
							return completion.promise;
						},
					},
				},
			}),
		),
		maxConcurrentActions: 2,
		maxPendingActions: 3,
	});
	const descriptor = command({ resource: "things", name: "go", input: {} });
	const actions = Array.from({ length: 4 }, (_, index) =>
		runtime.run(descriptor, { id: `submit-${index}` }),
	);
	assert.equal((await actions[3]?.result)?.kind, "failed");
	await tick();
	assert.equal(submitted, 2);
	assert.equal(peak, 2);
	acknowledgements[0]?.resolve();
	await tick();
	assert.equal(submitted, 3);
	assert.equal(actions[0]?.getSnapshot().phase, "running");
	acknowledgements[1]?.resolve();
	acknowledgements[2]?.resolve();
	completion.resolve({ kind: "succeeded" });
	await Promise.all(actions.map((action) => action.result));
	runtime.close();
});

test("queued commands recheck write permission at the dispatch boundary", async () => {
	const first = deferred<ActionOutcome>();
	let calls = 0;
	const runtime = createRuntime({
		...options(
			resource({
				commands: {
					go: {
						access: () => "write",
						disclosure: () => "read",
						run: () => {
							calls++;
							return first.promise;
						},
					},
				},
			}),
		),
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "write", state: "allowed" },
		],
		maxConcurrentActions: 1,
	});
	const descriptor = command({ resource: "things", name: "go", input: {} });
	const active = runtime.run(descriptor);
	const queued = runtime.run(descriptor);
	await tick();
	assert.equal(calls, 1);
	runtime.revoke("write");
	first.resolve({ kind: "succeeded" });
	assert.equal((await active.result).kind, "succeeded");
	const outcome = await queued.result;
	assert.equal(outcome.kind, "failed");
	if (outcome.kind === "failed") assert.equal(outcome.submitted, false);
	assert.equal(calls, 1);
	runtime.close();
});

test("unresolved action admission is bounded without discarding uncertainty or blocking local control", async () => {
	let submitted = 0,
		controlled = 0;
	const runtime = createRuntime({
		...options(
			resource({
				commands: {
					go: {
						access: () => "read",
						disclosure: () => "read",
						run: async (_command, context) => {
							submitted++;
							context.submitted();
							return { kind: "unknown", message: "No outcome proof" };
						},
					},
					retire: {
						execution: "control",
						access: () => "public",
						disclosure: () => "public",
						run: async () => {
							controlled++;
							return { kind: "succeeded" };
						},
					},
				},
			}),
		),
		maxUnresolvedActions: 2,
	});
	const descriptor = command({ resource: "things", name: "go", input: {} });
	await runtime.run(descriptor).result;
	await runtime.run(descriptor).result;
	assert.equal(runtime.availability(descriptor).state, "blocked");
	assert.equal((await runtime.run(descriptor).result).kind, "failed");
	assert.equal(submitted, 2);
	assert.equal(
		runtime
			.listActivities()
			.filter((action) => action.outcome?.kind === "unknown").length,
		2,
	);
	const control = command({ resource: "things", name: "retire", input: {} });
	assert.equal(runtime.availability(control).state, "available");
	assert.equal((await runtime.run(control).result).kind, "succeeded");
	assert.equal(controlled, 1);
	runtime.close();
});
