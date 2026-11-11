// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import { options, tick } from "../support/scenario.js";
import { executor, transferResource, upload } from "../support/transfers.js";

test("owner transfers use the same action and preserve domain-specific outcomes", async (t) => {
	const runtime = createRuntime({
		...options(
			transferResource({
				complete: (receipt) => {
					assert.equal(receipt.kind, "response");
					return {
						kind: "partial",
						value: { saved: true },
						message: "Saved, but downstream application failed",
					};
				},
			}),
		),
		transferFetch: async (_url, request) => {
			assert.equal(request?.method, "POST");
			assert.equal(await (request?.body as Blob).text(), "contents");
			return new Response("partial", { status: 200 });
		},
	});
	t.after(() => runtime.close());
	assert.equal(runtime.availability(upload).execution?.lifetime, "owner");
	const action = runtime.run(upload);
	assert.equal(action.getSnapshot().phase, "preparing");
	assert.equal((await action.result).kind, "partial");
	assert.equal(action.getSnapshot().execution?.lifetime, "owner");
	assert.equal(action.getSnapshot().recovery, "unavailable");
});

test("explicit owner cancellation settles as uncertain rather than successful rollback", async (t) => {
	const started = deferred<void>();
	const runtime = createRuntime({
		...options(transferResource()),
		transferFetch: async (_url, request) =>
			new Promise<Response>((_resolve, reject) => {
				assert.ok(request?.signal);
				request.signal.addEventListener(
					"abort",
					() => reject(request.signal?.reason),
					{ once: true },
				);
				started.resolve();
			}),
	});
	t.after(() => runtime.close());
	const action = runtime.run(upload);
	await started.promise;
	assert.equal(action.getSnapshot().controls.canCancel, true);
	await action.cancel();
	assert.equal((await action.result).kind, "unknown");
	assert.equal(action.getSnapshot().controls.canRetry, false);
});

test("invalid preparation never dispatches and is a known failed attempt", async (t) => {
	let dispatched = 0;
	const runtime = createRuntime({
		...options(
			transferResource({
				prepare: () => {
					throw new Error("Select a file");
				},
			}),
		),
		transferFetch: async () => {
			dispatched++;
			return new Response();
		},
	});
	t.after(() => runtime.close());
	const result = await runtime.run(upload).result;
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.submitted, false);
	assert.equal(dispatched, 0);
});

test("only an explicitly unavailable handoff permits owner fallback", async (t) => {
	for (const failure of ["unavailable", "ambiguous"] as const) {
		let fetched = 0;
		const persistence = new MemoryPersistence();
		const runtime = createRuntime({
			...options(transferResource()),
			persistence,
			transfers: executor({
				start: async () => {
					if (failure === "ambiguous")
						throw new Error("The handoff acknowledgement was lost");
					return {
						kind: "unavailable",
						reason: "Background Fetch is not supported",
					};
				},
			}),
			transferFetch: async () => {
				fetched++;
				return new Response("ok");
			},
		});
		t.after(() => runtime.close());
		await runtime.ready;
		const action = runtime.run(upload);
		assert.equal(
			(await action.result).kind,
			failure === "unavailable" ? "succeeded" : "unknown",
		);
		assert.equal(fetched, failure === "unavailable" ? 1 : 0);
	}
});

test("unavailable checkpoint storage permits only reduced owner-bound execution", async (t) => {
	const persistence = new MemoryPersistence();
	const errors: unknown[] = [];
	const runtime = createRuntime({
		...options(transferResource()),
		persistence,
		transfers: executor(),
		transferFetch: async () => new Response("ok"),
		onError: (error) => errors.push(error),
	});
	t.after(() => runtime.close());
	await runtime.ready;
	persistence.failure = new Error("Storage unavailable");
	const action = runtime.run(upload);
	assert.equal((await action.result).kind, "succeeded");
	assert.equal(action.getSnapshot().execution?.lifetime, "owner");
	assert.equal(action.getSnapshot().recovery, "unavailable");
	assert.ok(errors.length > 0);
});

test("oversized responses remain uncertain and cannot produce a domain success", async (t) => {
	let interpreted = 0;
	const runtime = createRuntime({
		...options(
			transferResource({
				complete: () => {
					interpreted++;
					return { kind: "succeeded" };
				},
			}),
		),
		transferFetch: async () => new Response("x".repeat(65537)),
	});
	t.after(() => runtime.close());
	assert.equal((await runtime.run(upload).result).kind, "unknown");
	assert.equal(interpreted, 0);
	await tick();
});
