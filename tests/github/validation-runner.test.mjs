// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { browserValidationTasks } from "../../scripts/lib/browser-validation.mjs";
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

test("independent work overlaps within the limit and failure waits for running siblings", async () => {
	let active = 0;
	let peak = 0;
	const started = [];
	const gates = new Map();
	const tasks = Object.fromEntries(
		["a", "b", "c"].map((name) => [
			name,
			{
				run: async () => {
					started.push(name);
					peak = Math.max(peak, ++active);
					await new Promise((resolve) => gates.set(name, resolve));
					active--;
					if (name === "a") throw Error("failure");
				},
			},
		]),
	);
	tasks.all = { needs: ["a", "b", "c"] };
	const execute = createTaskRunner(tasks, { concurrency: 2 });
	let settled = false;
	const result = execute("all").finally(() => {
		settled = true;
	});
	const rejection = assert.rejects(result, /failure/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(started, ["a", "b"]);
	gates.get("a")();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(started, ["a", "b", "c"]);
	assert.equal(settled, false);
	gates.get("b")();
	gates.get("c")();
	await rejection;
	assert.equal(active, 0);
	assert.equal(peak, 2);
});

test("browser engines share the task budget with builds instead of nesting parallel processes", async () => {
	let active = 0,
		peak = 0;
	const visited = [];
	const work = async (name) => {
		visited.push(name);
		peak = Math.max(peak, ++active);
		await new Promise((resolve) => setImmediate(resolve));
		active--;
	};
	const execute = createTaskRunner(
		{
			"build:ui": { run: () => work("ui") },
			...browserValidationTasks(work),
			build: { run: () => work("build") },
			all: { needs: ["browser:all", "build"] },
		},
		{ concurrency: 2 },
	);
	await execute("all");
	assert.equal(peak, 2);
	assert.deepEqual(visited.toSorted(), [
		"build",
		"chromium",
		"firefox",
		"ui",
		"webkit",
	]);
});
