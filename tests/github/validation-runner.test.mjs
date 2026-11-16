// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { createTaskRunner } from "../../scripts/lib/validation-runner.mjs";

test("concurrent consumers share one prerequisite and never run before it finishes", async () => {
	const order = [];
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const execute = createTaskRunner({
		build: {
			run: async () => {
				order.push("build");
				await gate;
				order.push("ready");
			},
		},
		first: { needs: ["build"], run: () => order.push("first") },
		second: { needs: ["build"], run: () => order.push("second") },
	});
	const consumers = Promise.all([execute("first"), execute("second")]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["build"]);
	release();
	await consumers;
	await execute("build");
	assert.deepEqual(order, ["build", "ready", "first", "second"]);
});

test("a failed prerequisite prevents its consumers and does not get silently retried", async () => {
	let attempts = 0;
	const execute = createTaskRunner({
		build: {
			run: () => {
				attempts++;
				throw Error("build failed");
			},
		},
		consumer: { needs: ["build"], run: () => assert.fail("Must not run") },
	});
	await assert.rejects(execute("consumer"), /build failed/);
	await assert.rejects(execute("build"), /build failed/);
	assert.equal(attempts, 1);
	assert.throws(() => execute("missing"), /Unknown validation task/);
});
