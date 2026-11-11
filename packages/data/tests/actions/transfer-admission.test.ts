// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import type { TransferObserver } from "../../src/transfer-types.js";
import { options } from "../support/scenario.js";
import {
	executor,
	response,
	transferResource,
	upload,
} from "../support/transfers.js";

for (const retirement of ["write", "authority"] as const) {
	test(`${retirement} retirement fences a deferred handoff and its owner fallback`, async (t) => {
		const persistence = new MemoryPersistence();
		const probed = deferred<TransferObserver>();
		const resume = deferred<void>();
		let fetched = 0;
		const definition = transferResource(
			{},
			{ access: "write", disclosure: "public" },
		);
		const runtime = createRuntime({
			...options(definition),
			persistence,
			access:
				retirement === "write" ? [{ scope: "write", state: "allowed" }] : [],
			transfers: executor({
				start: async (_id, _request, observer) => {
					probed.resolve(observer);
					await resume.promise;
					return { kind: "unavailable", reason: "No browser support" };
				},
			}),
			transferFetch: async () => {
				fetched++;
				return new Response();
			},
		});
		t.after(() => runtime.close());
		await runtime.ready;
		const action = runtime.run(upload);
		const observer = await probed.promise;
		assert.equal(observer.canSubmit(), true);
		if (retirement === "write") runtime.revoke("write");
		else
			runtime.setAccess({
				contextId: "bob",
				retirePrevious: true,
				decisions: [],
			});
		assert.equal(
			observer.signal.aborted,
			false,
			"readable activity is retained",
		);
		assert.equal(
			observer.canSubmit(),
			false,
			"new execution authority was withdrawn",
		);
		await runtime.flush();
		assert.equal(
			await persistence.claimTransfer(action.id),
			false,
			"durable dispatch is fenced too",
		);
		resume.resolve();
		const outcome = await action.result;
		assert.equal(outcome.kind, "failed");
		if (outcome.kind === "failed") assert.equal(outcome.submitted, false);
		assert.equal(fetched, 0);
	});
}

test("unestablished write permission still permits an explicit transfer attempt", async (t) => {
	const persistence = new MemoryPersistence();
	const runtime = createRuntime({
		...options(
			transferResource({}, { access: { any: ["denied", "unknown-write"] } }),
		),
		persistence,
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "denied", state: "denied" },
		],
		transfers: executor({
			start: async (id, _request, observer) => {
				assert.equal(observer.canSubmit(), true);
				assert.equal(await persistence.claimTransfer(id), true);
				observer.accepted();
				return response;
			},
		}),
	});
	t.after(() => runtime.close());
	await runtime.ready;
	assert.equal(runtime.availability(upload).state, "unknown");
	assert.equal((await runtime.run(upload).result).kind, "succeeded");
});
