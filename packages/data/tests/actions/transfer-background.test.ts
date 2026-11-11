// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import type {
	TransferObserver,
	TransferReceipt,
} from "../../src/transfer-types.js";
import { options, tick } from "../support/scenario.js";
import {
	executor,
	response,
	transferResource,
	upload,
} from "../support/transfers.js";

test("browser ownership begins at acceptance and keeps progress in the original action", async (t) => {
	const persistence = new MemoryPersistence();
	const started = deferred<TransferObserver>();
	const completed = deferred<TransferReceipt>();
	const runtime = createRuntime({
		...options(transferResource()),
		persistence,
		transfers: executor({
			start: async (id, _request, observer) => {
				const journal = persistence.actions.get(id);
				assert.equal(journal?.possibleSubmission, true);
				assert.equal(journal?.transfer?.state, "prepared");
				assert.equal(
					journal?.command.input,
					undefined,
					"upload bytes never enter the action journal",
				);
				started.resolve(observer);
				return completed.promise;
			},
		}),
	});
	t.after(() => runtime.close());
	await runtime.ready;
	const action = runtime.run(upload);
	const observer = await started.promise;
	assert.equal(action.getSnapshot().execution?.lifetime, "owner");
	observer.accepted();
	await runtime.flush();
	const acceptedSnapshot = action.getSnapshot();
	const acceptedJournal = persistence.actions.get(action.id);
	observer.accepted();
	await runtime.flush();
	assert.equal(
		action.getSnapshot(),
		acceptedSnapshot,
		"repeated acceptance does not republish",
	);
	assert.equal(
		persistence.actions.get(action.id),
		acceptedJournal,
		"repeated acceptance does not checkpoint again",
	);
	observer.progress({ completed: 4, total: 8 });
	const progressSnapshot = action.getSnapshot();
	observer.progress({ completed: 4, total: 8 });
	assert.equal(
		action.getSnapshot(),
		progressSnapshot,
		"unchanged progress does not republish",
	);
	assert.equal(action.getSnapshot().execution?.lifetime, "browser");
	assert.equal(action.getSnapshot().progress?.completed, 4);
	assert.equal(runtime.listActivities()[0]?.id, action.id);
	completed.resolve(response);
	assert.equal((await action.result).kind, "succeeded");
	await runtime.flush();
	assert.equal(
		persistence.actions.get(action.id)?.transfer?.receipt?.kind,
		"response",
	);
});

for (const stop of ["close", "revoke"] as const) {
	test(`${stop} stops browser observation without canceling accepted execution or admitting late effects`, async () => {
		const persistence = new MemoryPersistence();
		const started = deferred<TransferObserver>();
		const completed = deferred<TransferReceipt>();
		let canceled = 0,
			interpreted = 0;
		const runtime = createRuntime({
			...options(
				transferResource({
					complete: () => {
						interpreted++;
						return { kind: "succeeded" };
					},
				}),
			),
			persistence,
			transfers: executor({
				start: async (_id, _request, observer) => {
					observer.accepted();
					started.resolve(observer);
					return completed.promise;
				},
				cancel: async () => {
					canceled++;
				},
			}),
		});
		await runtime.ready;
		const action = runtime.run(upload);
		const observer = await started.promise;
		if (stop === "close") runtime.close();
		else runtime.revoke("read");
		assert.equal(observer.signal.aborted, true);
		assert.equal(canceled, 0);
		assert.equal((await action.result).kind, "unknown");
		completed.resolve(response);
		await tick();
		assert.equal(interpreted, 0);
		assert.equal(runtime.listActivities().length, 0);
		runtime.close();
	});
}

test("explicit background cancellation uses its executor and preserves uncertain remote effects", async (t) => {
	const persistence = new MemoryPersistence();
	const started = deferred<void>();
	const completed = deferred<TransferReceipt>();
	let canceled: string | undefined;
	const runtime = createRuntime({
		...options(transferResource()),
		persistence,
		transfers: executor({
			start: async (_id, _request, observer) => {
				observer.accepted();
				started.resolve();
				return completed.promise;
			},
			cancel: async (id) => {
				canceled = id;
				completed.resolve({
					kind: "unknown",
					message: "Canceled; a partial file may remain",
				});
			},
		}),
	});
	t.after(() => runtime.close());
	await runtime.ready;
	const action = runtime.run(upload);
	await started.promise;
	await action.cancel();
	assert.equal(canceled, action.id);
	assert.equal((await action.result).kind, "unknown");
});

test("recovery interprets durable response evidence without preparing or sending again", async () => {
	for (const hasReceipt of [true, false]) {
		const persistence = new MemoryPersistence();
		const started = deferred<void>();
		let prepared = 0,
			dispatched = 0,
			recovered = 0;
		const definition = transferResource({
			prepare: () => {
				prepared++;
				return {
					url: "https://service.test/upload",
					method: "POST",
					body: new Blob(["private input"]),
				};
			},
		});
		const first = createRuntime({
			...options(definition),
			persistence,
			transfers: executor({
				start: async (_id, _request, observer) => {
					dispatched++;
					observer.accepted();
					started.resolve();
					return new Promise<TransferReceipt>(() => {});
				},
			}),
		});
		await first.ready;
		const action = first.run(upload);
		await started.promise;
		await first.flush();
		first.close();
		const saved = persistence.actions.get(action.id);
		assert.ok(saved?.transfer);
		await persistence.recordTransfer(action.id, {
			state: "accepted",
			receipt: hasReceipt
				? response
				: { kind: "unknown", message: "An earlier observer lost contact" },
		});
		const second = createRuntime({
			...options(definition),
			persistence,
			transfers: executor({
				recover: async (id, observer) => {
					assert.equal(id, action.id);
					recovered++;
					observer.accepted();
					return response;
				},
			}),
			transferFetch: async () => {
				throw new Error("Recovery must not fetch a replacement");
			},
		});
		await second.ready;
		await tick();
		assert.equal(second.listActivities()[0]?.outcome?.kind, "succeeded");
		assert.equal(second.listActivities()[0]?.execution?.lifetime, "browser");
		assert.equal(prepared, 1);
		assert.equal(dispatched, 1);
		assert.equal(recovered, hasReceipt ? 0 : 1);
		second.close();
	}
});
