// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { grantKey } from "../../src/access.js";
import { proofLeaves } from "../../src/access-proofs.js";
import { command } from "../../src/descriptors.js";
import type { Restoration } from "../../src/runtime/restoration.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import type { ActionOutcome, ObservationBatch } from "../../src/types.js";

import { fact, list, options, resource, tick } from "../support/scenario.js";

test("unfinished recovery investigates and never resubmits", async () => {
	const persistence = new MemoryPersistence();
	let runs = 0,
		recoveries = 0;
	const pending = deferred<ActionOutcome>();
	const definition = resource({
		commands: {
			start: {
				access: () => "read",
				disclosure: () => "read",
				recovery: () => ({ operation: "op-1" }),
				run: () => {
					runs++;
					return pending.promise;
				},
				recover: async () => {
					recoveries++;
					return { kind: "unknown", message: "Still investigating" };
				},
			},
		},
	});
	const first = createRuntime({ ...options(definition), persistence });
	await first.ready;
	first.run(
		command({
			resource: "things",
			name: "start",
			target: "a",
			input: { secret: "must not persist" },
		}),
	);
	await tick();
	await first.flush();
	first.close();
	assert.equal(runs, 1);
	assert.equal(
		JSON.stringify([...persistence.actions.values()]).includes(
			"must not persist",
		),
		false,
	);
	const second = createRuntime({ ...options(definition), persistence });
	await second.ready;
	await tick();
	assert.equal(runs, 1);
	assert.equal(recoveries, 1);
	second.close();
});

test("an older preparing checkpoint cannot prove accepted work was never submitted", async () => {
	for (const supportedRecovery of [true, false]) {
		const persistence = new MemoryPersistence();
		const writeAction = persistence.writeAction.bind(persistence);
		let writes = 0;
		persistence.writeAction = async (journal) => {
			if (++writes > 1) throw new Error("Storage failed after preparing");
			await writeAction(journal);
		};
		const dispatched = deferred<void>();
		const pending = deferred<ActionOutcome>();
		let runs = 0;
		let recoveries = 0;
		const definition = resource({
			commands: {
				go: {
					access: () => "read",
					disclosure: () => "read",
					run: () => {
						runs++;
						dispatched.resolve();
						return pending.promise;
					},
					recover: supportedRecovery
						? async () => {
								recoveries++;
								return { kind: "unknown", message: "Investigated" };
							}
						: undefined,
				},
			},
		});
		const first = createRuntime({ ...options(definition), persistence });
		await first.ready;
		first.run(command({ resource: "things", name: "go", input: undefined }));
		await dispatched.promise;
		assert.equal(
			[...persistence.actions.values()][0]?.possibleSubmission,
			false,
		);
		first.close();
		persistence.writeAction = writeAction;
		const second = createRuntime({ ...options(definition), persistence });
		await second.ready;
		await tick();
		assert.equal(runs, 1);
		assert.equal(recoveries, supportedRecovery ? 1 : 0);
		assert.equal(second.listActivities()[0]?.outcome?.kind, "unknown");
		assert.equal(second.listActivities()[0]?.controls.canRetry, false);
		second.close();
	}
});

test("restored activity never evaluates new-command input or admission", async () => {
	for (const outcome of ["settled", "unfinished"] as const) {
		const persistence = new MemoryPersistence();
		const pending = deferred<ActionOutcome>();
		let runs = 0;
		let recoveries = 0;
		let admissionChecks = 0;
		const errors: unknown[] = [];
		const definition = resource({
			commands: {
				state: {
					disclosure: (descriptor, context) => {
						assert.equal(
							(descriptor.input as { action: string }).action,
							"start",
						);
						assert.equal(context.access("read"), "allowed");
						admissionChecks++;
						return "read";
					},
					access: (descriptor) => {
						assert.equal(
							(descriptor.input as { action: string }).action,
							"start",
						);
						return "read";
					},
					availability: (descriptor) => {
						assert.equal(
							(descriptor.input as { action: string }).action,
							"start",
						);
						admissionChecks++;
						return { state: "available" };
					},
					run: async () => {
						runs++;
						return outcome === "settled"
							? { kind: "succeeded" }
							: pending.promise;
					},
					recover: async () => {
						recoveries++;
						return {
							kind: "unknown",
							message: "Operation history unavailable",
						};
					},
				},
			},
		});
		const first = createRuntime({ ...options(definition), persistence });
		await first.ready;
		const action = first.run(
			command({
				resource: "things",
				name: "state",
				input: { action: "start" },
			}),
		);
		if (outcome === "settled") await action.result;
		await tick();
		await first.flush();
		first.close();
		assert.equal(
			[...persistence.actions.values()][0]?.command.input,
			undefined,
		);
		const previousChecks = admissionChecks;
		const second = createRuntime({
			...options(definition),
			persistence,
			onError: (error) => errors.push(error),
		});
		await second.ready;
		await tick();
		await second.flush();
		assert.deepEqual(errors, []);
		assert.equal(runs, 1);
		assert.equal(recoveries, outcome === "unfinished" ? 1 : 0);
		assert.equal(admissionChecks, previousChecks);
		assert.equal(second.listActivities()[0]?.phase, "settled");
		assert.deepEqual(second.listActivities()[0]?.controls, {
			canCancel: false,
			canRetry: false,
		});
		second.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
		second.close();
	}
});

test("storage failure leaves ordinary data and explicit actions working", async () => {
	const persistence = new MemoryPersistence();
	persistence.failure = new Error("unavailable");
	const runtime = createRuntime({
		...options(
			resource({
				commands: {
					go: {
						access: () => "read",
						disclosure: () => "read",
						run: async () => ({ kind: "succeeded" }),
					},
				},
			}),
		),
		persistence,
	});
	await runtime.ready;
	runtime.observe({ facts: [fact("a", { name: "A" })] });
	const action = runtime.run(
		command({ resource: "things", name: "go", input: {} }),
	);
	assert.equal((await action.result).kind, "succeeded");
	assert.equal(action.getSnapshot().recovery, "unavailable");
	assert.equal(runtime.watch(list).getSnapshot().rows[0]?.data.name, "A");
	await assert.rejects(runtime.flush(), /unavailable/);
	runtime.close();
});

test("protected hydration waits for authority identity and positive access", async () => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({
		...options(resource({ persist: () => true })),
		persistence,
	});
	await first.ready;
	first.observe({ facts: [fact("a", { name: "Private" })] });
	await first.flush();
	first.close();
	const second = createRuntime({
		resources: [resource({ persist: () => true })],
		contextId: "discovering",
		persistence,
	});
	await second.ready;
	const watch = second.watch(list);
	assert.equal(watch.getSnapshot().rows.length, 0);
	second.setAccess({
		contextId: "alice",
		decisions: [{ scope: "read", state: "allowed" }],
	});
	assert.equal(watch.getSnapshot().rows[0]?.data.name, "Private");
	assert.equal(watch.getSnapshot().rows[0]?.fields.name?.stale, true);
	second.close();
});

test("revocation forgets quarantined activity metadata even when durable removal fails", async () => {
	const persistence = new MemoryPersistence();
	const definition = resource({
		commands: {
			go: {
				access: () => "read",
				disclosure: (descriptor) => ({
					any: descriptor.target === "shared" ? ["read", "public"] : ["read"],
				}),
				recovery: (descriptor) => ({ protectedDetail: descriptor.target }),
				run: async () => ({ kind: "succeeded" }),
			},
		},
	});
	const first = createRuntime({ ...options(definition), persistence });
	await first.ready;
	for (const target of ["private", "shared"])
		await first.run(
			command({ resource: "things", name: "go", target, input: undefined }),
		).result;
	await first.flush();
	const stored = await persistence.load();
	first.close();
	const second = createRuntime({
		resources: [definition],
		contextId: "discovering",
		persistence,
	});
	await second.ready;
	const restoration = Reflect.get(second, "restoration") as Restoration;
	assert.equal(restoration.pendingRecovery.length, 2);
	assert.equal(second.listActivities().length, 1);
	assert.equal(second.listActivities()[0]?.target, "shared");
	second.setAccess({
		contextId: "alice",
		retirePrevious: false,
		decisions: [],
	});
	assert.equal(restoration.pendingRecovery.length, 2);
	assert.equal(second.listActivities().length, 1);
	persistence.failure = new Error("Cannot erase durable payloads");
	second.revoke("read");
	assert.deepEqual(
		restoration.pendingRecovery.map((journal) => journal.metadata),
		[{ protectedDetail: "shared" }],
	);
	assert.deepEqual(
		restoration.pendingRecovery[0]?.bases
			.flatMap(proofLeaves)
			.map((basis) => basis.scope),
		["public"],
	);
	assert.equal(second.listActivities()[0]?.target, "shared");
	await assert.rejects(second.flush(), /Cannot erase durable payloads/);
	second.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(second.listActivities().length, 1);
	second.close();
	persistence.failure = undefined;
	const privateBasis = stored.actions
		.find((journal) => journal.command.target === "private")
		?.bases.flatMap(proofLeaves)[0];
	assert.ok(privateBasis);
	persistence.load = async () => ({
		...stored,
		revoked: { [grantKey(privateBasis)]: privateBasis.generation },
	});
	const third = createRuntime({ ...options(definition), persistence });
	await third.ready;
	const restored = Reflect.get(third, "restoration") as Restoration;
	assert.deepEqual(
		restored.pendingRecovery.map((journal) => journal.metadata),
		[{ protectedDetail: "shared" }],
	);
	assert.equal(third.listActivities().length, 1);
	third.close();
});

test("late hydration and old-owner revocations cannot replace newly established evidence", async () => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({
		...options(resource({ persist: () => true })),
		persistence,
	});
	await first.ready;
	first.observe({ facts: [fact("a", { name: "Old" })] });
	await first.flush();
	first.revoke("read");
	await first.flush();
	first.close();
	const snapshot = await persistence.load();
	const load = deferred<typeof snapshot>();
	persistence.load = () => load.promise;
	const second = createRuntime({
		...options(resource({ persist: () => true })),
		persistence,
	});
	second.observe({ facts: [fact("a", { name: "Fresh" })] });
	load.resolve(snapshot);
	await second.ready;
	await second.flush();
	assert.equal(second.watch(list).getSnapshot().rows[0]?.data.name, "Fresh");
	assert.equal(
		[...persistence.facts.values()].find((entry) => entry.field === "name")
			?.value,
		"Fresh",
	);
	second.close();
});

test("a late successful GET cannot resurrect a subsequently deleted resource", async () => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime(
		options(
			resource({
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "status"],
						membership: true,
						run: async () => response.promise,
					},
				],
			}),
		),
	);
	const read = runtime.read(list);
	await tick();
	runtime.observe({
		facts: [
			{
				resource: "things",
				identity: "a",
				presence: "absent",
				basis: ["read"],
			},
		],
	});
	response.resolve({ facts: [fact("a", { name: "Late" })] });
	await read;
	assert.equal(runtime.watch(list).getSnapshot().rows.length, 0);
	runtime.close();
});

test("new-owner durable writes advance beyond hydrated revisions before committing", async () => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({
		...options(resource({ persist: () => true })),
		persistence,
	});
	await first.ready;
	for (let index = 0; index < 50; index++)
		first.observe({ facts: [fact("a", { name: `old-${index}` })] });
	await first.flush();
	first.close();
	const snapshot = await persistence.load();
	const high = Math.max(...snapshot.facts.map((entry) => entry.revision));
	const hydration = deferred<typeof snapshot>();
	persistence.load = () => hydration.promise;
	const second = createRuntime({
		...options(resource({ persist: () => true })),
		persistence,
	});
	second.observe({ facts: [fact("a", { name: "new-owner" })] });
	hydration.resolve(snapshot);
	await second.ready;
	await second.flush();
	const saved = [...persistence.facts.values()].find(
		(entry) => entry.field === "name",
	);
	assert.equal(saved?.value, "new-owner");
	assert.ok(saved && saved.revision > high);
	second.close();
});
