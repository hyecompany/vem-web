// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Dexie } from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { grantKey } from "../../src/access.js";
import {
	DexiePersistence,
	persistenceSchemaVersion,
} from "../../src/persistence.js";
import { MemoryPersistence } from "../../src/testing/memory.js";
import type { TransferReceipt } from "../../src/transfer-types.js";
import type { ActionJournal } from "../../src/types.js";

const alice = { scope: "read", contextId: "alice", generation: 1 };
const response: TransferReceipt = {
	kind: "response",
	status: 200,
	headers: { etag: "version-1" },
	body: "saved",
};
function journal(id = crypto.randomUUID()): ActionJournal {
	return {
		id,
		command: {
			kind: "command",
			resource: "files",
			name: "upload",
			input: undefined,
		},
		bases: [alice],
		possibleSubmission: true,
		transfer: { version: 1, state: "prepared", admission: { all: [] } },
		snapshot: {
			id,
			resource: "files",
			name: "upload",
			contextId: "alice",
			phase: "running",
			recovery: "saved",
			revision: 1,
			controls: { canCancel: false, canRetry: false },
		},
	};
}
function stores(t: TestContext) {
	const name = crypto.randomUUID();
	const first = new DexiePersistence(name, { indexedDB, IDBKeyRange });
	const second = new DexiePersistence(name, { indexedDB, IDBKeyRange });
	t.after(() => {
		first.close();
		second.close();
	});
	return { name, first, second };
}

test("only one connection can claim a checkpointed transfer", async (t) => {
	const { first, second } = stores(t);
	const action = journal();
	await first.writeAction(action);
	const claimed = await Promise.all([
		first.claimTransfer(action.id),
		second.claimTransfer(action.id),
	]);
	assert.deepEqual(claimed.sort(), [false, true]);
	assert.equal((await first.readTransfer(action.id))?.state, "dispatching");
	assert.equal(await second.claimTransfer(action.id), false);
	assert.equal(persistenceSchemaVersion, 3);
});

test("missing, unrelated and uncheckpointed actions cannot dispatch or gain receipt records", async (t) => {
	const { first } = stores(t);
	const missing = crypto.randomUUID();
	assert.equal(await first.readTransfer(missing), undefined);
	assert.equal(await first.claimTransfer(missing), false);
	assert.equal(
		await first.recordTransfer(missing, {
			state: "accepted",
			receipt: response,
		}),
		false,
	);
	assert.deepEqual((await first.load()).actions, []);
	const unrelated = journal();
	delete unrelated.transfer;
	const uncheckpointed = { ...journal(), possibleSubmission: false };
	await first.writeAction(unrelated);
	await first.writeAction(uncheckpointed);
	for (const action of [unrelated, uncheckpointed]) {
		assert.equal(await first.claimTransfer(action.id), false);
		assert.equal(
			await first.recordTransfer(action.id, {
				state: "accepted",
				receipt: response,
			}),
			false,
		);
	}
	assert.equal(await first.readTransfer(unrelated.id), undefined);
	assert.deepEqual(await first.readTransfer(uncheckpointed.id), {
		version: 1,
		admission: { all: [] },
		state: "prepared",
	});
});

test("concurrent action checkpoints preserve browser receipt evidence and the latest snapshot", async (t) => {
	const { first, second } = stores(t);
	for (const receiptFirst of [false, true]) {
		const action = journal();
		await first.writeAction(action);
		await first.claimTransfer(action.id);
		const checkpoint = {
			...action,
			snapshot: { ...action.snapshot, revision: 4 },
		};
		const receipt = () =>
			second.recordTransfer(action.id, {
				state: "accepted",
				receipt: response,
			});
		const save = () => first.writeAction(checkpoint);
		await Promise.all(receiptFirst ? [receipt(), save()] : [save(), receipt()]);
		assert.deepEqual(await first.readTransfer(action.id), {
			version: 1,
			admission: { all: [] },
			state: "accepted",
			receipt: response,
		});
		const stale = { ...action, snapshot: { ...action.snapshot, revision: 2 } };
		await second.writeAction(stale);
		const later = {
			...checkpoint,
			possibleSubmission: false,
			snapshot: { ...checkpoint.snapshot, revision: 5 },
		};
		delete later.transfer;
		await first.writeAction(later);
		const saved = (await first.load()).actions.find(
			(entry) => entry.id === action.id,
		);
		assert.equal(saved?.snapshot.revision, 5);
		assert.equal(saved?.possibleSubmission, true);
		assert.deepEqual(saved?.transfer, {
			version: 1,
			admission: { all: [] },
			state: "accepted",
			receipt: response,
		});
	}
});

test("transfer evidence advances independently of action snapshot revisions", async (t) => {
	const { first } = stores(t);
	const action = journal();
	await first.writeAction({
		...action,
		snapshot: { ...action.snapshot, revision: 9 },
	});
	await first.writeAction({
		...action,
		transfer: { version: 1, state: "accepted", receipt: response },
	});
	const saved = (await first.load()).actions[0];
	assert.equal(saved?.snapshot.revision, 9);
	assert.deepEqual(saved?.transfer, {
		version: 1,
		admission: { all: [] },
		state: "accepted",
		receipt: response,
	});
});

test("an unknown receipt can gain response evidence without replacing an established response", async (t) => {
	const { first } = stores(t);
	const action = journal();
	await first.writeAction(action);
	await first.recordTransfer(action.id, {
		state: "accepted",
		receipt: { kind: "unknown", message: "Connection closed" },
	});
	await first.recordTransfer(action.id, {
		state: "dispatching",
		receipt: response,
	});
	await first.recordTransfer(action.id, {
		state: "prepared",
		receipt: { kind: "response", status: 500, headers: {}, body: "different" },
	});
	await first.recordTransfer(action.id, {
		state: "accepted",
		receipt: { kind: "unknown", message: "Later observation failed" },
	});
	assert.deepEqual(await first.readTransfer(action.id), {
		version: 1,
		admission: { all: [] },
		state: "accepted",
		receipt: response,
	});
	assert.equal(await first.claimTransfer(action.id), false);
});

test("revocation fences completion and stale checkpoints while a new action can use a regrant", async (t) => {
	const { first, second } = stores(t);
	const action = journal();
	await first.writeAction(action);
	await first.claimTransfer(action.id);
	await Promise.all([
		first.revoke([alice]),
		second.recordTransfer(action.id, { state: "accepted", receipt: response }),
	]);
	assert.equal(await second.readTransfer(action.id), undefined);
	assert.equal(
		await second.recordTransfer(action.id, {
			state: "accepted",
			receipt: response,
		}),
		false,
	);
	await second.writeAction({
		...action,
		snapshot: { ...action.snapshot, revision: 99 },
	});
	assert.deepEqual((await first.load()).actions, []);
	const renewed = { ...journal(), bases: [{ ...alice, generation: 2 }] };
	await first.writeAction(renewed);
	assert.equal(await second.claimTransfer(renewed.id), true);
	assert.equal(
		await second.recordTransfer(renewed.id, {
			state: "accepted",
			receipt: response,
		}),
		true,
	);
	assert.equal(
		await second.recordTransfer(action.id, {
			state: "accepted",
			receipt: response,
		}),
		false,
	);
});

test("committed tombstones deny transfer access before asynchronous payload removal", async (t) => {
	const { name, first, second } = stores(t);
	const action = journal();
	await first.writeAction(action);
	const raw = new Dexie(name, { indexedDB, IDBKeyRange });
	await raw.open();
	t.after(() => raw.close());
	await raw
		.table("tombstones")
		.put({ scope: grantKey(alice), generation: alice.generation });
	assert.ok(await raw.table("actions").get(action.id));
	assert.equal(await second.readTransfer(action.id), undefined);
	assert.equal(await second.claimTransfer(action.id), false);
	assert.equal(
		await second.recordTransfer(action.id, {
			state: "accepted",
			receipt: response,
		}),
		false,
	);
	assert.equal(
		(await raw.table("actions").get(action.id)).transfer.receipt,
		undefined,
	);
});

test("independent disclosure bases preserve receipts until the final permission is retired", async (t) => {
	const { first, second } = stores(t);
	const bob = { ...alice, contextId: "bob" };
	const action = { ...journal(), bases: [alice, bob] };
	await first.writeAction(action);
	await first.revoke([alice]);
	assert.equal(await second.claimTransfer(action.id), true);
	assert.equal(
		await second.recordTransfer(action.id, {
			state: "accepted",
			receipt: response,
		}),
		true,
	);
	assert.deepEqual((await second.readTransfer(action.id))?.receipt, response);
	await first.revoke([bob]);
	assert.equal(await second.readTransfer(action.id), undefined);
});

test("UTF-8 receipt bounds reject oversized updates without changing existing evidence", async (t) => {
	const { first } = stores(t);
	const action = journal();
	await first.writeAction(action);
	const maximumBody = {
		kind: "response",
		status: 200,
		headers: {},
		body: "é".repeat(32768),
	} as const;
	await first.recordTransfer(action.id, {
		state: "accepted",
		receipt: maximumBody,
	});
	const before = await first.readTransfer(action.id);
	const excessive: TransferReceipt[] = [
		{ ...maximumBody, body: "é".repeat(32769) },
		{ ...maximumBody, headers: { data: "é".repeat(8192) } },
		{ kind: "unknown", message: "é".repeat(2049) },
	];
	for (const receipt of excessive) {
		await assert.rejects(
			first.recordTransfer(action.id, { state: "accepted", receipt }),
			/recovery limit/,
		);
		await assert.rejects(
			first.writeAction({
				...action,
				transfer: { version: 1, state: "accepted", receipt },
			}),
			/recovery limit/,
		);
		assert.deepEqual(await first.readTransfer(action.id), before);
	}
});

test("queued receipt input is captured and returned evidence cannot mutate durable storage", async (t) => {
	const { first } = stores(t);
	const action = journal();
	await first.writeAction(action);
	const receipt = {
		kind: "response" as const,
		status: 200,
		headers: { etag: "original" },
		body: "original",
	};
	const pending = first.recordTransfer(action.id, {
		state: "accepted",
		receipt,
	});
	receipt.body = "mutated";
	receipt.headers.etag = "mutated";
	await pending;
	const stored = await first.readTransfer(action.id);
	assert.equal(stored?.receipt?.kind, "response");
	if (stored?.receipt?.kind !== "response") throw new Error("Response missing");
	assert.equal(stored.receipt.body, "original");
	assert.equal(stored.receipt.headers.etag, "original");
	assert.ok(Object.isFrozen(stored.receipt.headers));
	assert.ok(Object.isFrozen(stored.receipt));
	assert.deepEqual(await first.readTransfer(action.id), stored);
});

test("memory fixtures expose the same protected monotonic transfer receipt contract", async () => {
	const storage = new MemoryPersistence();
	const action = journal();
	assert.equal(
		await storage.recordTransfer(action.id, {
			state: "accepted",
			receipt: response,
		}),
		false,
	);
	await storage.writeAction(action);
	assert.deepEqual(
		await Promise.all([
			storage.claimTransfer(action.id),
			storage.claimTransfer(action.id),
		]),
		[true, false],
	);
	await storage.recordTransfer(action.id, {
		state: "accepted",
		receipt: { kind: "unknown", message: "Waiting for evidence" },
	});
	await storage.recordTransfer(action.id, {
		state: "accepted",
		receipt: response,
	});
	await storage.writeAction({
		...action,
		snapshot: { ...action.snapshot, revision: 5 },
	});
	await storage.writeAction({
		...action,
		transfer: {
			version: 1,
			admission: { all: [] },
			state: "dispatching",
			receipt: { kind: "unknown", message: "Old observation" },
		},
	});
	assert.equal((await storage.load()).actions[0]?.snapshot.revision, 5);
	assert.deepEqual(await storage.readTransfer(action.id), {
		version: 1,
		admission: { all: [] },
		state: "accepted",
		receipt: response,
	});
	await assert.rejects(
		storage.recordTransfer(action.id, {
			state: "accepted",
			receipt: { kind: "unknown", message: "é".repeat(2049) },
		}),
		/recovery limit/,
	);
	await storage.revoke([alice]);
	assert.equal(await storage.readTransfer(action.id), undefined);
	assert.equal(await storage.claimTransfer(action.id), false);
	assert.equal(
		await storage.recordTransfer(action.id, {
			state: "accepted",
			receipt: response,
		}),
		false,
	);
	await storage.writeAction(action);
	assert.deepEqual((await storage.load()).actions, []);
	storage.failure = new Error("Storage unavailable");
	await assert.rejects(storage.readTransfer(action.id), /Storage unavailable/);
});

for (const adapter of ["dexie", "memory"] as const) {
	test(`${adapter}: write-only revocation prevents handoff while preserving readable action evidence`, async (t) => {
		const storage =
			adapter === "dexie" ? stores(t).first : new MemoryPersistence();
		const write = { ...alice, scope: "write" };
		const pending = journal();
		pending.transfer = { version: 1, state: "prepared", admission: write };
		const accepted = journal();
		accepted.transfer = { version: 1, state: "prepared", admission: write };
		await storage.writeAction(pending);
		await storage.writeAction(accepted);
		assert.equal(await storage.claimTransfer(accepted.id), true);
		await storage.revoke([write]);
		assert.equal(await storage.claimTransfer(pending.id), false);
		assert.ok(await storage.readTransfer(pending.id));
		assert.equal(
			await storage.recordTransfer(accepted.id, {
				state: "accepted",
				receipt: response,
			}),
			true,
		);
		await storage.writeAction({
			...pending,
			transfer: {
				version: 1,
				state: "prepared",
				admission: { ...write, generation: 2 },
			},
			snapshot: { ...pending.snapshot, revision: 9 },
		});
		assert.deepEqual(
			(await storage.readTransfer(pending.id))?.admission,
			write,
		);
		assert.equal(await storage.claimTransfer(pending.id), false);
		assert.deepEqual(
			(await storage.readTransfer(accepted.id))?.receipt,
			response,
		);
		assert.equal((await storage.load()).actions.length, 2);
	});
}

for (const adapter of ["dexie", "memory"] as const) {
	test(`${adapter}: a handoff without captured admission is refused`, async (t) => {
		const storage =
			adapter === "dexie" ? stores(t).first : new MemoryPersistence();
		const action = journal();
		action.transfer = { version: 1, state: "prepared" };
		await storage.writeAction(action);
		assert.equal(await storage.claimTransfer(action.id), false);
		assert.ok(await storage.readTransfer(action.id));
	});
}
