// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { BrowserClient, protocolVersion } from "../../src/client.js";
import {
	command,
	commandKey,
	query,
	stableKey,
} from "../../src/descriptors.js";
import {
	type Compatibility,
	emptyResult,
	type Publication,
} from "../../src/protocol.js";
import {
	emptyReadModel,
	readModelDelta,
} from "../../src/read-model/publication.js";
import type { ReadModelRecord } from "../../src/read-model/types.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type {
	ActionOutcome,
	PreparedEdit,
	QueryResult,
	ResourceDefinition,
	ResourceReadDefinition,
} from "../../src/types.js";
import { createSharedHost } from "../../src/worker.js";

const continuity = { channel: "test-events" };

const compatibility: Compatibility = {
	protocol: protocolVersion,
	schema: 1,
	definitions: 1,
	build: "first",
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await tick();
	}
	assert.ok(predicate(), "Expected publication did not arrive");
}

class Locks implements LockManager {
	#queues = new Map<string, { start(): void; abort(): void }[]>();
	#active = new Map<string, { release(): void }>();
	request<T>(
		name: string,
		options: LockOptions | ((lock: Lock | null) => T | PromiseLike<T>),
		callback?: (lock: Lock | null) => T | PromiseLike<T>,
	): Promise<T> {
		const fn = typeof options === "function" ? options : callback;
		const signal = typeof options === "function" ? undefined : options.signal;
		return new Promise<T>((resolve, reject) => {
			let granted = false;
			const entry = {
				start: () => {
					granted = true;
					signal?.removeEventListener("abort", entry.abort);
					const held = {
						release: () => {
							if (this.#active.get(name) === held) this.#active.delete(name);
							this.#drain(name);
						},
					};
					this.#active.set(name, held);
					void Promise.resolve()
						.then(() => fn?.({ name, mode: "exclusive" }))
						.then((value) => resolve(value as T), reject)
						.finally(held.release);
				},
				abort: () => {
					if (granted) return;
					this.#queues.set(
						name,
						(this.#queues.get(name) ?? []).filter((item) => item !== entry),
					);
					reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
				},
			};
			if (signal?.aborted) {
				entry.abort();
				return;
			}
			const queue = this.#queues.get(name) ?? [];
			queue.push(entry);
			this.#queues.set(name, queue);
			signal?.addEventListener("abort", entry.abort, { once: true });
			queueMicrotask(() => this.#drain(name));
		});
	}
	#drain(name: string): void {
		if (!this.#active.has(name)) this.#queues.get(name)?.shift()?.start();
	}
	abandon(name: string): void {
		this.#active.get(name)?.release();
	}
	async query(): Promise<LockManagerSnapshot> {
		return {
			held: [...this.#active.keys()].map((name) => ({
				name,
				mode: "exclusive",
			})),
			pending: [],
		};
	}
}

function channel(
	t: TestContext,
	attach?: (port: MessagePort) => void,
	options: {
		locks?: LockManager;
		compatibility?: Compatibility;
		maxInactiveQueries?: number;
		readDefinitions?: readonly ResourceReadDefinition[];
	} = {},
) {
	const pair = new MessageChannel();
	const client = new BrowserClient(
		pair.port1,
		options.compatibility ?? compatibility,
		{
			locks: options.locks,
			maxInactiveQueries: options.maxInactiveQueries,
			readDefinitions: options.readDefinitions ?? [{ name: "things" }],
		},
	);
	const messages: Record<string, unknown>[] = [];
	if (attach) attach(pair.port2);
	else {
		pair.port2.addEventListener("message", (event) =>
			messages.push(event.data),
		);
		pair.port2.start();
	}
	t.after(() => {
		client.close();
		pair.port2.close();
	});
	return { client, peer: pair.port2, port: pair.port1, messages };
}

const descriptor = (identity: string) =>
	query({ resource: "things", mode: "one", identity, select: ["name"] });
function result(name: string): QueryResult {
	return {
		...emptyResult(),
		rows: [
			{
				key: "a",
				identity: { kind: "resource", resource: "a" },
				data: { name },
				fields: {
					name: { source: "observed", liveness: "live", actionIds: [] },
				},
				actionIds: [],
				complete: true,
				missing: [],
			},
		],
		exists: true,
		settled: true,
	};
}
function publication(
	revision: number,
	values: Record<string, QueryResult>,
	options: Partial<Publication> = {},
): Publication {
	return {
		type: "publish",
		epoch: "owner",
		base: revision - 1,
		revision,
		reset: options.access !== undefined,
		readModel: readModelDelta(
			emptyReadModel(),
			{
				revision,
				records: Object.entries(values).flatMap(
					([id, value]): ReadModelRecord[] => {
						const descriptor = JSON.parse(id);
						return value.rows.map((row) => {
							const identity =
								descriptor.identity ??
								(row.identity.kind === "resource"
									? row.identity.resource
									: undefined);
							const key = `${descriptor.resource}:${stableKey(identity)}`;
							const confirmed = {
								key,
								identity,
								resource: descriptor.resource,
								presence: "present" as const,
								values: row.data,
								fields: Object.fromEntries(
									Object.entries(row.fields).filter(
										(
											entry,
										): entry is [string, NonNullable<(typeof entry)[1]>] =>
											entry[1] !== undefined,
									),
								),
							};
							return {
								key,
								confirmed,
								effective: {
									...confirmed,
									rowKey: key,
									actionIds: row.actionIds,
								},
								facts: Object.fromEntries(
									["$presence", ...Object.keys(row.fields)].map((field) => [
										field,
										{ revision },
									]),
								),
							};
						});
					},
				),
				memberships: [],
			},
			true,
		),
		queries: Object.entries(values).map(([id, value]) => ({
			id,
			status: {
				fetching: value.fetching,
				revalidating: value.revalidating,
				settled: value.settled,
				issues: value.issues,
			},
		})),
		availability: [],
		activities: [],
		access: {
			contextId: "alice",
			revision: 1,
			scopes: { read: { state: "allowed", generation: 1 } },
		},
		feedback: [],
		...options,
	};
}

test("client patches publish atomically and a gap requests an owner snapshot", async (t) => {
	const { client, peer, messages } = channel(t);
	const a = descriptor("a"),
		b = descriptor("b");
	const first = client.watch(a),
		second = client.watch(b);
	first.subscribe(() => undefined);
	second.subscribe(() => undefined);
	peer.postMessage({ type: "ready", compatibility });
	peer.postMessage(
		publication(
			1,
			{ [stableKey(a)]: result("old-a"), [stableKey(b)]: result("old-b") },
			{ reset: true },
		),
	);
	await until(() => first.getSnapshot().rows[0]?.data.name === "old-a");
	const seen: unknown[] = [];
	first.subscribe(() =>
		seen.push([
			first.getSnapshot().rows[0]?.data.name,
			second.getSnapshot().rows[0]?.data.name,
		]),
	);
	peer.postMessage(
		publication(2, {
			[stableKey(a)]: result("new-a"),
			[stableKey(b)]: result("new-b"),
		}),
	);
	await until(() => seen.length === 1);
	assert.deepEqual(seen, [["new-a", "new-b"]]);
	peer.postMessage(
		publication(4, { [stableKey(a)]: result("must-not-apply") }),
	);
	await until(() => messages.some((message) => message.type === "snapshot"));
	assert.equal(first.getSnapshot().rows[0]?.data.name, "new-a");
	peer.postMessage(
		publication(
			5,
			{ [stableKey(a)]: result("recovered"), [stableKey(b)]: result("new-b") },
			{ reset: true },
		),
	);
	await until(() => first.getSnapshot().rows[0]?.data.name === "recovered");
});

test("a full snapshot forgets omitted mirrors after a gap without canceling pending watches", async (t) => {
	const { client, peer, messages } = channel(t);
	const a = descriptor("a"),
		b = descriptor("b");
	const inactive = client.watch(a),
		returning = client.watch(b);
	const stopA = inactive.subscribe(() => undefined);
	const stopB = returning.subscribe(() => undefined);
	peer.postMessage({ type: "ready", compatibility });
	peer.postMessage(
		publication(
			1,
			{
				[stableKey(a)]: result("old-a"),
				[stableKey(b)]: result("old-b"),
			},
			{ reset: true },
		),
	);
	await until(() => inactive.getSnapshot().rows.length === 1);
	stopA();
	stopB();
	const stopReturning = returning.subscribe(() => undefined);
	// The forgotten-query publication was lost before this later publication.
	peer.postMessage(publication(3, {}));
	await until(() => messages.some((message) => message.type === "snapshot"));
	peer.postMessage(publication(4, {}, { reset: true }));
	await until(() => inactive.getSnapshot().rows.length === 0);
	assert.equal(returning.getSnapshot().rows.length, 0);
	assert.equal(returning.getSnapshot().confirmed.complete, false);
	peer.postMessage(publication(5, { [stableKey(b)]: result("current-b") }));
	await until(() => returning.getSnapshot().rows[0]?.data.name === "current-b");
	stopReturning();
});

test("inactive query handles cannot redisclose protected rows after an access transition", async (t) => {
	const { client, peer } = channel(t);
	const query = descriptor("a");
	const watch = client.watch(query);
	const stop = watch.subscribe(() => undefined);
	peer.postMessage({ type: "ready", compatibility });
	peer.postMessage(
		publication(1, { [stableKey(query)]: result("private") }, { reset: true }),
	);
	await until(() => watch.getSnapshot().rows.length === 1);
	stop();
	peer.postMessage(
		publication(
			2,
			{},
			{
				access: {
					contextId: "alice",
					revision: 2,
					scopes: { read: { state: "denied", generation: 2 } },
				},
			},
		),
	);
	await until(() => client.access("read") === "denied");
	assert.equal(watch.getSnapshot().rows.length, 0);
	assert.equal(client.watch(query).getSnapshot().rows.length, 0);
});

test("client demand is subscription owned while disclosed knowledge is readable without subscribing", async (t) => {
	const { client, peer, messages } = channel(t);
	const selected = descriptor("a");
	const upload = command({
		resource: "things",
		name: "upload",
		input: { file: new Blob(["bytes"]), transferId: "upload" },
	});
	const view = client.watch(selected);
	const availability = client.watchAvailability(upload);
	const discardQuery = view.subscribe(() => undefined);
	const discardCommand = availability.subscribe(() => undefined);
	discardQuery();
	discardCommand();
	peer.postMessage({ type: "ready", compatibility });
	peer.postMessage(
		publication(
			1,
			{ [stableKey(selected)]: result("orphan") },
			{
				reset: true,
				availability: [{ id: commandKey(upload), value: { state: "denied" } }],
			},
		),
	);
	await until(() => client.connectionSnapshot().phase === "ready");
	await tick();
	assert.equal(
		messages.some(
			(value) => value.type === "watch" || value.type === "availability",
		),
		false,
	);
	assert.equal(view.getSnapshot().rows[0]?.data.name, "orphan");
	assert.equal(availability.getSnapshot().state, "blocked");
	const stopView = view.subscribe(() => undefined);
	const stopCommand = availability.subscribe(() => undefined);
	await until(
		() =>
			messages.some((value) => value.type === "watch") &&
			messages.some((value) => value.type === "availability"),
	);
	peer.postMessage(
		publication(
			2,
			{ [stableKey(selected)]: result("subscribed") },
			{
				availability: [
					{ id: commandKey(upload), value: { state: "available" } },
				],
			},
		),
	);
	await until(() => view.getSnapshot().rows[0]?.data.name === "subscribed");
	assert.equal(availability.getSnapshot().state, "available");
	stopView();
	stopCommand();
	assert.equal(view.getSnapshot().rows[0]?.data.name, "subscribed");
	assert.equal(availability.getSnapshot().state, "blocked");
	const again = view.subscribe(() => undefined);
	peer.postMessage(
		publication(3, { [stableKey(selected)]: result("reattached") }),
	);
	await until(() => view.getSnapshot().rows[0]?.data.name === "reattached");
	again();
});

test("an edit submitted after client closure settles as unknown without dispatch", async (t) => {
	const { client } = channel(t);
	client.close();
	const prepared: PreparedEdit<{ name: string }> = {
		descriptor: { kind: "edit", resource: "things", name: "edit", target: "a" },
		values: { name: "before" },
		baseline: {},
		etag: "one",
		fieldDisclosure: {
			name: { scope: "read", generation: 1, contextId: "alice" },
		},
		writeAccess: "write",
		contextId: "alice",
		accessGeneration: 0,
	};
	const action = client.saveEdit(prepared, { name: "after" });
	assert.equal((await action.result).kind, "unknown");
	assert.equal(action.getSnapshot().phase, "settled");
	assert.throws(() => action.retry({ id: action.id }), /different input/);
	const retry = action.retry();
	assert.equal((await retry.result).kind, "unknown");
	assert.equal(retry.getSnapshot().phase, "settled");
});

async function host(
	t: TestContext,
	definition: ResourceDefinition,
	locks = new Locks(),
	limits: { runtime?: number; resources?: readonly ResourceDefinition[] } = {},
) {
	const runtime = createRuntime({
		resources: [definition, ...(limits.resources ?? [])],
		maxInactiveQueries: limits.runtime,
		contextId: "alice",
		access: [{ scope: "read", state: "allowed" }],
	});
	await runtime.ready;
	const disposed = deferred<void>();
	const attach = await createSharedHost({
		compatibility,
		lockName: "owner",
		locks,
		create: async () => ({
			client: runtime,
			dispose: () => disposed.resolve(),
		}),
	});
	t.after(() => runtime.close());
	return { runtime, locks, attach, disposed };
}

test("withdrawn action observers settle without retaining protected identities or canceling server work", async (t) => {
	for (const timing of ["after-publication", "during-dispatch"] as const) {
		const completion = deferred<ActionOutcome>();
		let revoke = () => {};
		let canceled = 0;
		const owner = await host(t, {
			name: "things",
			commands: {
				go: {
					access: () => "read",
					disclosure: () => "read",
					run: () => {
						if (timing === "during-dispatch") revoke();
						return completion.promise;
					},
					cancel: async () => {
						canceled++;
					},
				},
				publicWork: {
					access: () => "public",
					disclosure: () => "public",
					run: () => completion.promise,
				},
			},
		});
		revoke = () => owner.runtime.revoke("read");
		const client = channel(t, owner.attach, { locks: owner.locks }).client;
		await until(() => client.connectionSnapshot().phase === "ready");
		const shared = client.run(
			command({
				resource: "things",
				name: "publicWork",
				target: "public-target",
				input: undefined,
			}),
		);
		const action = client.run(
			command({
				resource: "things",
				name: "go",
				target: "protected-target",
				input: undefined,
			}),
		);
		let outcome: ActionOutcome | undefined;
		void action.result.then((value) => {
			outcome = value;
		});
		if (timing === "after-publication") {
			await until(() => action.getSnapshot().phase === "running");
			assert.ok(
				action
					.getSnapshot()
					.references?.some((ref) => ref.identity === "protected-target"),
			);
			revoke();
		}
		await until(() => outcome !== undefined);
		assert.equal(outcome?.kind, "unknown");
		assert.equal(action.getSnapshot().target, undefined);
		assert.equal(action.getSnapshot().references, undefined);
		assert.equal(action.getSnapshot().phase, "settled");
		assert.equal(canceled, 0);
		assert.equal(shared.getSnapshot().target, "public-target");
		assert.equal(shared.getSnapshot().phase, "running");
		completion.resolve({ kind: "succeeded" });
		assert.equal((await shared.result).kind, "succeeded");
		owner.runtime.setAccess({
			decisions: [{ scope: "read", state: "allowed" }],
		});
		await tick();
		assert.equal(action.getSnapshot().references, undefined);
	}
});

test("compatible builds share the owner while incompatible definitions are rejected", async (t) => {
	const owner = await host(t, { name: "things" });
	const accepted = channel(t, owner.attach, {
		locks: owner.locks,
		compatibility: { ...compatibility, build: "next" },
	}).client;
	const rejected = channel(t, owner.attach, {
		locks: owner.locks,
		compatibility: { ...compatibility, definitions: 2 },
	}).client;
	await until(
		() =>
			accepted.connectionSnapshot().phase === "ready" &&
			rejected.connectionSnapshot().phase === "incompatible",
	);
	assert.equal(accepted.connectionSnapshot().updateAvailable, true);
	assert.equal(accepted.connectionSnapshot().owner?.build, "first");
	assert.equal((await accepted.upgrade()).ready, true);
	await owner.disposed.promise;
});

test("an accepted upgrade waits for disposal and owner release before permitting reload", async (t) => {
	const locks = new Locks();
	const disposal = deferred<void>();
	const started = deferred<void>();
	const runtime = createRuntime({ resources: [{ name: "things" }] });
	t.after(() => runtime.close());
	const attach = await createSharedHost({
		compatibility,
		lockName: "owner",
		locks,
		create: async () => ({
			client: runtime,
			dispose: async () => {
				started.resolve();
				await disposal.promise;
			},
		}),
	});
	const client = channel(t, attach, { locks }).client;
	await until(() => client.connectionSnapshot().phase === "ready");
	let completed = false;
	const upgrade = client.upgrade().then((result) => {
		completed = true;
		return result;
	});
	await started.promise;
	await until(() => client.connectionSnapshot().phase === "closed");
	assert.equal(
		completed,
		false,
		"retirement notice does not prove owner disposal",
	);
	disposal.resolve();
	assert.equal((await upgrade).ready, true);
});

test("duplicate commands are admitted once and feedback transfers after a starting tab disappears", async (t) => {
	let calls = 0;
	const outcome = deferred<ActionOutcome>();
	const owner = await host(t, {
		name: "things",
		commands: {
			go: {
				access: () => "read",
				disclosure: () => "read",
				run: () => {
					calls++;
					return outcome.promise;
				},
			},
		},
	});
	const a = channel(t, owner.attach, { locks: owner.locks });
	const b = channel(t, owner.attach, { locks: owner.locks });
	const cmd = command({ resource: "things", name: "go", input: {} });
	const first = a.client.run(cmd, { id: "same-action" });
	const second = b.client.run(cmd, { id: "same-action" });
	await until(() => calls === 1 && a.client.feedback().includes(first.id));
	assert.throws(
		() =>
			a.client.run({ ...cmd, input: { different: true } }, { id: first.id }),
		/different input/,
	);
	assert.equal(b.client.feedback().length, 0);
	const conflicting = channel(t, owner.attach, { locks: owner.locks }).client;
	await until(() => conflicting.connectionSnapshot().phase === "ready");
	const rejected = conflicting.run(
		{ ...cmd, input: { different: true } },
		{ id: first.id },
	);
	assert.equal((await rejected.result).kind, "failed");
	assert.equal(rejected.getSnapshot().outcome?.kind, "failed");
	assert.equal(first.getSnapshot().phase, "running");
	const releaseInline = a.client.claimFeedback([first.id]);
	await until(() => a.client.feedback().length === 0);
	releaseInline();
	await until(() => a.client.feedback().includes(first.id));
	a.port.close();
	owner.locks.abandon(`vem-client:${a.client.id}`);
	await until(() => b.client.feedback().includes(first.id));
	assert.equal(calls, 1);
	outcome.resolve({ kind: "succeeded" });
	assert.equal((await second.result).kind, "succeeded");
	assert.equal((await b.client.upgrade()).ready, true);
	await owner.disposed.promise;
});

test("upgrading refuses active work and releases ownership only after disposal", async (t) => {
	const pending = deferred<ActionOutcome>();
	const owner = await host(t, {
		name: "things",
		commands: {
			go: {
				access: () => "read",
				disclosure: () => "read",
				run: () => pending.promise,
			},
		},
	});
	const client = channel(t, owner.attach, { locks: owner.locks }).client;
	const action = client.run(
		command({ resource: "things", name: "go", input: {} }),
	);
	await until(() =>
		client.listActivities().some((value) => value.phase === "running"),
	);
	assert.equal((await client.upgrade()).ready, false);
	let nextStarted = false;
	const nextRuntime = createRuntime({ resources: [{ name: "things" }] });
	t.after(() => nextRuntime.close());
	const next = createSharedHost({
		compatibility: { ...compatibility, build: "next" },
		lockName: "owner",
		locks: owner.locks,
		create: async () => {
			nextStarted = true;
			return { client: nextRuntime, dispose() {} };
		},
	});
	await tick();
	assert.equal(nextStarted, false);
	pending.resolve({ kind: "succeeded" });
	await action.result;
	assert.equal((await client.upgrade()).ready, true);
	await owner.disposed.promise;
	await until(() => client.connectionSnapshot().phase !== "ready");
	const attach = await next;
	assert.equal(nextStarted, true);
	const replacement = channel(t, attach, { locks: owner.locks }).client;
	assert.equal((await replacement.upgrade()).ready, true);
});

test("an explicit query feedback region owns new work from its first publication and releases it on navigation", async (t) => {
	const outcome = deferred<ActionOutcome>();
	const owner = await host(t, {
		name: "things",
		commands: {
			go: {
				access: () => "read",
				disclosure: () => "read",
				run: () => outcome.promise,
			},
		},
	});
	const client = channel(t, owner.attach, { locks: owner.locks }).client;
	const query = descriptor("a");
	const watch = client.watch(query);
	const stop = watch.subscribe(() => undefined);
	let release = client.claimQueryFeedback(query);
	const seen: { actions: string[]; feedback: readonly string[] }[] = [];
	client.subscribe(() =>
		seen.push({
			actions: watch.getSnapshot().activities.map((action) => action.id),
			feedback: client.feedback(),
		}),
	);
	const action = client.run(
		command({ resource: "things", name: "go", target: "a", input: {} }),
	);
	await until(() =>
		watch.getSnapshot().activities.some((value) => value.id === action.id),
	);
	assert.equal(
		seen
			.filter((value) => value.actions.includes(action.id))
			.some((value) => value.feedback.includes(action.id)),
		false,
	);
	release();
	await until(() => client.feedback().includes(action.id));
	assert.equal(watch.getSnapshot().activities[0]?.id, action.id);
	release = client.claimQueryFeedback(query);
	await until(() => !client.feedback().includes(action.id));
	stop();
	await until(() => client.feedback().includes(action.id));
	release();
	outcome.resolve({ kind: "succeeded" });
	await action.result;
	assert.equal((await client.upgrade()).ready, true);
	await owner.disposed.promise;
});

test("owner lock loss settles outstanding work as unknown without replay", async (t) => {
	let runs = 0;
	const unfinished = deferred<ActionOutcome>();
	const owner = await host(t, {
		name: "things",
		commands: {
			go: {
				access: () => "read",
				disclosure: () => "read",
				run: () => {
					runs++;
					return unfinished.promise;
				},
			},
		},
	});
	const client = channel(t, owner.attach, { locks: owner.locks }).client;
	const view = client.watch(
		query({ resource: "things", mode: "list", select: [] }),
	);
	view.subscribe(() => undefined);
	const action = client.run(
		command({ resource: "things", name: "go", target: "a", input: {} }),
	);
	await until(
		() =>
			runs === 1 &&
			view.getSnapshot().activities.some((value) => value.id === action.id),
	);
	owner.locks.abandon("owner");
	assert.equal((await action.result).kind, "unknown");
	assert.equal(action.getSnapshot().outcome?.kind, "unknown");
	assert.equal(view.getSnapshot().activities[0]?.outcome?.kind, "unknown");
	assert.equal(view.getSnapshot().activities[0]?.phase, "settled");
	assert.equal(client.connectionSnapshot().phase, "failed");
	assert.equal(runs, 1);
	unfinished.resolve({ kind: "succeeded" });
});

test("dismissing progress is shared without cancelling work and a new outcome has its own acknowledgement", async (t) => {
	const outcome = deferred<ActionOutcome>();
	const owner = await host(t, {
		name: "things",
		commands: {
			go: {
				access: () => "read",
				disclosure: () => "read",
				run: () => outcome.promise,
			},
		},
	});
	const first = channel(t, owner.attach, { locks: owner.locks }).client;
	const second = channel(t, owner.attach, { locks: owner.locks }).client;
	const action = first.run(
		command({ resource: "things", name: "go", input: {} }),
	);
	await until(() => first.feedback().includes(action.id));
	const progress = action.getSnapshot();
	first.acknowledgeFeedback(action.id, progress);
	await until(() => first.feedback().length === 0);
	assert.equal(action.getSnapshot().phase, "running");
	first.close();
	await until(() =>
		second.listActivities().some((value) => value.id === action.id),
	);
	assert.equal(second.feedback().length, 0);
	outcome.resolve({ kind: "succeeded" });
	await until(() => second.feedback().includes(action.id));
	second.acknowledgeFeedback(action.id, progress);
	await tick();
	assert.ok(second.feedback().includes(action.id));
	second.acknowledgeFeedback(action.id, second.listActivities()[0]);
	await until(() => second.feedback().length === 0);
	const third = channel(t, owner.attach, { locks: owner.locks }).client;
	second.close();
	await until(() =>
		third.listActivities().some((value) => value.id === action.id),
	);
	assert.equal(third.feedback().length, 0);
	assert.equal(third.listActivities()[0]?.outcome?.kind, "succeeded");
	assert.equal((await third.upgrade()).ready, true);
	await owner.disposed.promise;
});

test("inactive mirrors follow evidence and access without acquiring until reattached", async (t) => {
	let reads = 0;
	const owner = await host(t, {
		name: "things",
		sources: [
			{
				key: "collection",
				mode: "list",
				fields: ["name", "label", "status"],
				membership: true,
				run: async () => {
					reads++;
					return {
						facts: [
							{
								resource: "things",
								identity: "a",
								presence: "present",
								values: { name: "private", label: "public", status: "Running" },
								basis: ["public"],
								fieldBasis: { name: ["read"], status: ["read"] },
							},
						],
						memberships: [
							{
								resource: "things",
								identities: ["a"],
								complete: true,
								basis: ["public"],
							},
						],
					};
				},
			},
		],
	});
	const { client } = channel(t, owner.attach);
	const selected = query({
		resource: "things",
		mode: "list",
		select: ["name", "label"],
		where: { status: "Running" },
	});
	const view = client.watch(selected);
	const stop = view.subscribe(() => {});
	await until(() => view.getSnapshot().rows[0]?.data.name === "private");
	stop();
	await tick();
	await tick();
	owner.runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "status" }],
	});
	await until(() => view.getSnapshot().unresolved.length === 1);
	assert.equal(view.getSnapshot().rows.length, 0);
	assert.equal(reads, 1);
	owner.runtime.observe({
		facts: [
			{
				resource: "things",
				identity: "a",
				values: { name: "new", status: "Running" },
				basis: ["read"],
			},
		],
	});
	await until(() => view.getSnapshot().rows[0]?.data.name === "new");
	assert.equal(client.watch(selected).getSnapshot().rows[0]?.data.name, "new");
	assert.equal(reads, 1);
	const attach = view.subscribe(() => {});
	assert.equal(view.getSnapshot().rows[0]?.data.name, "new");
	attach();
	await tick();
	await tick();
	owner.runtime.setAccess({ decisions: [{ scope: "read", state: "unknown" }] });
	await until(
		() =>
			client.access("read") === "unknown" &&
			view.getSnapshot().unresolved.length === 1,
	);
	assert.equal(view.getSnapshot().unresolved[0]?.data.name, undefined);
	assert.equal(view.getSnapshot().unresolved[0]?.data.label, "public");
	owner.runtime.revoke("read");
	await until(() => client.access("read") === "denied");
	owner.runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	await until(() => client.access("read") === "allowed");
	assert.equal(view.getSnapshot().unresolved[0]?.data.name, undefined);
	assert.equal(view.getSnapshot().unresolved[0]?.data.label, "public");
	assert.equal(reads, 1);
});

test("a running acquisition can complete into an inactive mirror without retaining demand", async (t) => {
	const complete = deferred<void>();
	let reads = 0;
	const owner = await host(t, {
		name: "things",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				run: async () => {
					reads++;
					await complete.promise;
					return {
						facts: [
							{
								resource: "things",
								identity: "a",
								presence: "present",
								values: { name: "arrived" },
								basis: ["read"],
							},
						],
					};
				},
			},
		],
	});
	const { client } = channel(t, owner.attach);
	const selected = descriptor("a");
	const view = client.watch(selected);
	const stop = view.subscribe(() => {});
	await until(() => view.getSnapshot().fetching);
	stop();
	await tick();
	await tick();
	complete.resolve();
	await until(() => view.getSnapshot().rows[0]?.data.name === "arrived");
	const again = client.watch(selected);
	assert.equal(again.getSnapshot().rows[0]?.data.name, "arrived");
	assert.equal(again.getSnapshot().fetching, false);
	assert.equal(reads, 1);
});

test("inactive mirrors receive proposal rollback and coverage uncertainty without new acquisition", async (t) => {
	const completed = deferred<ActionOutcome>();
	let reads = 0;
	const owner = await host(t, {
		name: "things",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				run: async () => {
					reads++;
					return {
						facts: [
							{
								liveness: continuity,
								resource: "things",
								identity: "a",
								presence: "present",
								values: { name: "before" },
								basis: ["read"],
							},
						],
					};
				},
			},
		],
		commands: {
			rename: {
				access: () => "read",
				disclosure: () => "read",
				project: () => [
					{
						resource: "things",
						identity: "a",
						kind: "update",
						values: { name: "proposal" },
						basis: ["read"],
					},
				],
				run: () => completed.promise,
			},
		},
	});
	const { client } = channel(t, owner.attach);
	const selected = descriptor("a");
	const view = client.watch(selected);
	const stop = view.subscribe(() => {});
	await until(() => view.getSnapshot().rows[0]?.data.name === "before");
	stop();
	await tick();
	await tick();
	const action = owner.runtime.run(
		command({
			resource: "things",
			name: "rename",
			target: "a",
			input: undefined,
		}),
	);
	await until(() => view.getSnapshot().rows[0]?.data.name === "proposal");
	owner.runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { name: "server" },
				basis: ["read"],
			},
		],
	});
	completed.resolve({
		kind: "failed",
		error: { message: "Rejected" },
		submitted: false,
	});
	await action.result;
	await until(() => view.getSnapshot().rows[0]?.data.name === "server");
	owner.runtime.setContinuity(continuity, "interrupted");
	await until(() => view.getSnapshot().rows[0]?.fields.name?.stale === true);
	assert.equal(reads, 1);
});

test("inactive explicit sampling stops at the owner while its last result remains observable", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	let reads = 0;
	const owner = await host(t, {
		name: "things",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				run: async () => ({
					facts: [
						{
							resource: "things",
							identity: "a",
							presence: "present",
							values: { name: String(++reads) },
							basis: ["read"],
						},
					],
				}),
			},
		],
	});
	const { client } = channel(t, owner.attach);
	const selected = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["name"],
		sample: { fields: ["name"], intervalMs: 100 },
	});
	const view = client.watch(selected);
	const stop = view.subscribe(() => {});
	await until(() => view.getSnapshot().rows[0]?.data.name === "1");
	t.mock.timers.tick(100);
	await until(() => view.getSnapshot().rows[0]?.data.name === "2");
	stop();
	await tick();
	await tick();
	t.mock.timers.tick(1000);
	await tick();
	await tick();
	assert.equal(reads, 2);
	assert.equal(view.getSnapshot().rows[0]?.data.name, "2");
});

test("query metadata eviction preserves synchronously readable owner knowledge", async (t) => {
	for (const limit of ["client", "runtime"] as const) {
		const owner = await host(t, { name: "things" }, new Locks(), {
			runtime: limit === "runtime" ? 1 : undefined,
		});
		owner.runtime.observe({
			facts: ["a", "b", "active"].map((identity) => ({
				resource: "things",
				identity,
				presence: "present" as const,
				values: { name: identity },
				basis: ["read"],
			})),
		});
		const { client } = channel(t, owner.attach, {
			maxInactiveQueries: limit === "client" ? 1 : undefined,
		});
		const active = client.watch(descriptor("active"));
		const keep = active.subscribe(() => {});
		await until(() => active.getSnapshot().rows.length === 1);
		const first = client.watch(descriptor("a"));
		const stopA = first.subscribe(() => {});
		await until(() => first.getSnapshot().rows.length === 1);
		stopA();
		await tick();
		await tick();
		const second = client.watch(descriptor("b"));
		const stopB = second.subscribe(() => {});
		await until(() => second.getSnapshot().rows.length === 1);
		stopB();
		await tick();
		await tick();
		assert.equal(first.getSnapshot().rows[0]?.data.name, "a");
		assert.equal(second.getSnapshot().rows[0]?.data.name, "b");
		assert.equal(active.getSnapshot().rows[0]?.data.name, "active");
		keep();
	}
});

test("runtime query eviction across tabs preserves knowledge without recreating inactive demand", async (t) => {
	const owner = await host(t, { name: "things" }, new Locks(), { runtime: 1 });
	owner.runtime.observe({
		facts: ["a", "b"].map((identity) => ({
			resource: "things",
			identity,
			presence: "present" as const,
			values: { name: identity },
			basis: ["read"],
		})),
	});
	const first = channel(t, owner.attach).client;
	const second = channel(t, owner.attach).client;
	const a = first.watch(descriptor("a"));
	const b = second.watch(descriptor("b"));
	const stopA = a.subscribe(() => {});
	await until(() => a.getSnapshot().rows.length === 1);
	stopA();
	await tick();
	await tick();
	const stopB = b.subscribe(() => {});
	await until(() => b.getSnapshot().rows.length === 1);
	stopB();
	await until(() => owner.runtime.peekQuery(descriptor("a")) === undefined);
	assert.equal(owner.runtime.peekQuery(descriptor("a")), undefined);
	for (let index = 0; index < 3; index++) {
		owner.runtime.observe({
			facts: [
				{
					resource: "things",
					identity: "b",
					values: { name: `b${index}` },
					basis: ["read"],
				},
			],
		});
		await tick();
		await tick();
	}
	assert.equal(owner.runtime.peekQuery(descriptor("a")), undefined);
	assert.equal(a.getSnapshot().rows[0]?.data.name, "a");
	assert.equal(b.getSnapshot().rows[0]?.data.name, "b2");
});

test("missing read definitions fail clearly before creating query demand", (t) => {
	const pair = new MessageChannel();
	const client = new BrowserClient(pair.port1, compatibility);
	t.after(() => {
		client.close();
		pair.port2.close();
	});
	assert.throws(
		() => client.watch(descriptor("a")),
		/No read definition was configured for things/,
	);
});

test("a lost access reset quarantines private values immediately and restores public content only from a full snapshot", async (t) => {
	const { client, peer, messages } = channel(t);
	const privateQuery = descriptor("private");
	const publicQuery = descriptor("public");
	const privateView = client.watch(privateQuery);
	const publicView = client.watch(publicQuery);
	privateView.subscribe(() => undefined);
	publicView.subscribe(() => undefined);
	peer.postMessage({ type: "ready", compatibility });
	peer.postMessage(
		publication(
			1,
			{
				[stableKey(privateQuery)]: result("private"),
				[stableKey(publicQuery)]: result("public"),
			},
			{ reset: true },
		),
	);
	await until(() => privateView.getSnapshot().rows.length === 1);
	const access = {
		contextId: "alice",
		revision: 2,
		scopes: { read: { state: "denied" as const, generation: 2 } },
	};
	// The access-changing reset at revision two was lost before this delta.
	peer.postMessage(publication(3, {}, { reset: false, access }));
	await until(() => client.access("read") === "denied");
	assert.equal(privateView.getSnapshot().rows.length, 0);
	assert.equal(publicView.getSnapshot().rows.length, 0);
	assert.equal(privateView.getSnapshot().empty, false);
	assert.equal(privateView.getSnapshot().settled, false);
	assert.match(
		privateView.getSnapshot().issues[0]?.message ?? "",
		/Resynchronizing/,
	);
	await until(() => messages.some((message) => message.type === "snapshot"));
	peer.postMessage(
		publication(
			4,
			{ [stableKey(privateQuery)]: result("must stay hidden") },
			{ reset: false, access },
		),
	);
	await tick();
	assert.equal(privateView.getSnapshot().rows.length, 0);
	peer.postMessage(
		publication(
			5,
			{ [stableKey(publicQuery)]: result("public") },
			{ reset: true, access },
		),
	);
	await until(() => publicView.getSnapshot().rows.length === 1);
	assert.equal(privateView.getSnapshot().rows.length, 0);
	assert.equal(publicView.getSnapshot().rows[0]?.data.name, "public");
	assert.equal(
		publicView
			.getSnapshot()
			.issues.some((issue) => issue.message.includes("Resynchronizing")),
		false,
	);
});

test("owner acquisition metadata does not duplicate locally derived access restrictions", async (t) => {
	const definition: ResourceDefinition = {
		name: "things",
		access: () => "read",
	};
	const owner = await host(t, definition);
	const { client } = channel(t, owner.attach, {
		readDefinitions: [definition],
	});
	const view = client.watch(descriptor("a"));
	view.subscribe(() => undefined);
	await until(() => client.connectionSnapshot().phase === "ready");
	owner.runtime.revoke("read");
	await until(() => client.access("read") === "denied");
	assert.equal(
		view.getSnapshot().issues.filter((issue) => issue.kind === "access").length,
		1,
	);
});

test("inactive acquisition failures survive unrelated evidence until owner attempt state changes", async (t) => {
	let reads = 0;
	const owner = await host(
		t,
		{
			name: "things",
			sources: [
				{
					key: "detail",
					mode: "one",
					fields: ["name"],
					run: async () => {
						reads++;
						throw new Error("Offline");
					},
				},
			],
		},
		new Locks(),
		{ resources: [{ name: "other" }] },
	);
	const { client } = channel(t, owner.attach);
	const selected = descriptor("a");
	const view = client.watch(selected);
	const stop = view.subscribe(() => undefined);
	await until(
		() =>
			view.getSnapshot().settled &&
			view.getSnapshot().issues.some((issue) => issue.message === "Offline"),
	);
	stop();
	await tick();
	await tick();
	owner.runtime.observe({
		facts: [
			{
				resource: "other",
				identity: "b",
				presence: "present",
				values: { name: "unrelated" },
				basis: ["public"],
			},
		],
	});
	await tick();
	await tick();
	assert.equal(client.watch(selected).getSnapshot().settled, true);
	assert.equal(
		client.watch(selected).getSnapshot().issues[0]?.message,
		"Offline",
	);
	assert.equal(reads, 1);
	const retry = owner.runtime.watch(selected).retry();
	const returnToView = view.subscribe(() => undefined);
	await retry;
	await until(() => reads === 2 && view.getSnapshot().settled);
	returnToView();
});

test("connection failure publishes query and command state atomically", async (t) => {
	const { client, peer } = channel(t);
	const selected = descriptor("a");
	const command = {
		kind: "command" as const,
		resource: "things",
		name: "go",
		input: undefined,
	};
	const view = client.watch(selected);
	const available = client.watchAvailability(command);
	view.subscribe(() => undefined);
	available.subscribe(() => undefined);
	peer.postMessage({ type: "ready", compatibility });
	peer.postMessage(
		publication(
			1,
			{ [stableKey(selected)]: result("known") },
			{
				reset: true,
				availability: [
					{ id: commandKey(command), value: { state: "available" } },
				],
			},
		),
	);
	await until(() => available.getSnapshot().state === "available");
	const seen: string[] = [];
	view.subscribe(() => seen.push(available.getSnapshot().state));
	client.close();
	assert.deepEqual(seen, ["blocked"]);
	assert.equal(view.getSnapshot().rows[0]?.data.name, "known");
	assert.equal(view.getSnapshot().issues[0]?.kind, "read");
});

test("aborting before attachment removes the queued read", async (t) => {
	const { client, peer, messages } = channel(t);
	const controller = new AbortController();
	const pending = client.read(descriptor("a"), { signal: controller.signal });
	controller.abort(new Error("stop read"));
	await assert.rejects(pending, /stop read/);
	peer.postMessage({ type: "ready", compatibility });
	await until(() => client.connectionSnapshot().phase === "ready");
	const other = client.read(descriptor("b"));
	await until(() => messages.some((m) => m.type === "read"));
	const reads = messages.filter((m) => m.type === "read");
	assert.equal(reads.length, 1);
	assert.deepEqual(reads[0]?.query, descriptor("b"));
	peer.postMessage({
		type: "reply",
		id: reads[0]?.requestId,
		value: result("b"),
	});
	await other;
});

test("aborted browser reads release owner demand while another tab completes the shared acquisition", async (t) => {
	const held = deferred<void>();
	let reads = 0;
	const owner = await host(t, {
		name: "things",
		sources: [
			{
				key: "collection",
				mode: "list",
				fields: ["name"],
				membership: true,
				async run() {
					reads++;
					await held.promise;
					return {
						facts: [
							{
								resource: "things",
								identity: "a",
								presence: "present",
								values: { name: "shared" },
								basis: ["public"],
							},
						],
						memberships: [
							{
								resource: "things",
								identities: ["a"],
								complete: true,
								basis: ["public"],
							},
						],
					};
				},
			},
		],
	});
	const signals: AbortSignal[] = [];
	const read = owner.runtime.read.bind(owner.runtime);
	owner.runtime.read = ((q, options) => {
		if (options?.signal) signals.push(options.signal);
		return read(q, options);
	}) as typeof owner.runtime.read;
	const first = channel(t, owner.attach).client;
	const second = channel(t, owner.attach).client;
	const selected = query({
		resource: "things",
		mode: "list",
		select: ["name"],
	});
	const controller = new AbortController();
	const canceled = first.read(selected, { signal: controller.signal });
	const retained = second.read(selected);
	await until(() => signals.length === 2 && reads === 1);
	controller.abort(new Error("stop read"));
	await assert.rejects(canceled, /stop read/);
	await until(() => signals.filter((s) => s.aborted).length === 1);
	held.resolve();
	const received = await retained;
	assert.equal(received.rows[0]?.data.name, "shared");
	assert.equal(reads, 1);
	assert.equal(signals.filter((s) => s.aborted).length, 1);
});

test("canceling the only browser reader stops subsequent pages but retains permitted in-flight evidence", async (t) => {
	const held = deferred<void>();
	let calls = 0;
	const owner = await host(t, {
		name: "things",
		sources: [
			{
				key: "pages",
				mode: "list",
				fields: ["name"],
				membership: true,
				pagination: { pageSize: 1 },
				async run() {
					calls++;
					await held.promise;
					return {
						batch: {
							facts: [
								{
									resource: "things",
									identity: "a",
									presence: "present",
									values: { name: "retained" },
									basis: ["public"],
								},
							],
							memberships: [
								{
									resource: "things",
									identities: ["a"],
									complete: false,
									basis: ["public"],
								},
							],
						},
						next: "next-page",
					};
				},
			},
		],
	});
	let released = false;
	const read = owner.runtime.read.bind(owner.runtime);
	owner.runtime.read = (async (q, options) => {
		try {
			return await read(q, options);
		} finally {
			released = true;
		}
	}) as typeof owner.runtime.read;
	const { client } = channel(t, owner.attach);
	const selected = query({
		resource: "things",
		mode: "list",
		select: ["name"],
	});
	const controller = new AbortController();
	const pending = client.read(selected, { signal: controller.signal });
	await until(() => calls === 1);
	controller.abort(new Error("stop read"));
	await assert.rejects(pending, /stop read/);
	await until(() => released);
	held.resolve();
	await until(
		() => owner.runtime.peekQuery(selected)?.rows[0]?.data.name === "retained",
	);
	assert.equal(calls, 1);
});
