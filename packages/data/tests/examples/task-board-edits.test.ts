// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";
import { tasks } from "../../examples/task-board/contract.js";
import {
	createTaskDefinition,
	type TaskRecord,
	taskFact,
} from "../../examples/task-board/domain.js";

const target = { id: "walk" };
const task: TaskRecord = {
	...target,
	title: "Plan a walk",
	status: "open",
	notes: "By the river",
};
const response = (notes = task.notes, etag = '"one"') =>
	Response.json({ ...task, notes }, { headers: { ETag: etag } });

test("documented task detail and concurrent editors share an atomic writable representation", {
	timeout: 5000,
}, async (t) => {
	const started = deferred<void>(),
		pending = deferred<Response>();
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			createTaskDefinition(async () => {
				reads++;
				started.resolve();
				return pending.promise;
			}),
		],
		maxConcurrent: 1,
	});
	t.after(() => runtime.close());
	const detail = runtime.read(
		tasks.get(target, { select: ["title", "notes"] }),
	);
	await started.promise;
	const first = runtime.prepareEdit(tasks.edits.notes(target)),
		second = runtime.prepareEdit(tasks.edits.notes(target));
	pending.resolve(response());
	const [shown, a, b] = await Promise.all([detail, first, second]);
	assert.equal(reads, 1);
	assert.equal(shown.rows[0]?.data.notes, task.notes);
	assert.deepEqual(a.values, { notes: task.notes });
	assert.equal(a.etag, '"one"');
	assert.deepEqual(b.values, a.values);
	assert.equal(b.etag, a.etag);
});

test("a documented source without an ETag still supplies readable fields but cannot prepare an editor", async (t) => {
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			createTaskDefinition(async () => {
				reads++;
				return Response.json(task);
			}),
		],
	});
	t.after(() => runtime.close());
	await assert.rejects(
		runtime.prepareEdit(tasks.edits.notes(target)),
		/information|source/i,
	);
	const shown = await runtime.read(tasks.get(target, { select: ["notes"] }));
	assert.equal(shown.rows[0]?.data.notes, task.notes);
	assert.equal(reads, 1);
});

test("documented edits retain the original token through external changes and reacquire after conflict", async (t) => {
	let reads = 0,
		notes = task.notes,
		token = '"one"';
	const writes: string[] = [];
	const runtime = createRuntime({
		resources: [
			createTaskDefinition(async (_path, _context, init) => {
				if (init?.method === "PUT") {
					const submitted = new Headers(init.headers).get("If-Match");
					writes.push(submitted ?? "");
					return submitted !== token
						? new Response(null, { status: 412 })
						: response(notes, token);
				}
				reads++;
				return response(notes, token);
			}),
		],
	});
	t.after(() => runtime.close());
	const first = await runtime.prepareEdit(tasks.edits.notes(target));
	notes = "Choose a different trail";
	token = '"two"';
	runtime.event("tasks", { ...task, notes });
	assert.equal(first.etag, '"one"');
	const failed = await runtime.saveEdit(first, { notes: "My draft" }).result;
	assert.equal(failed.kind, "failed");
	assert.deepEqual(writes, ['"one"']);
	const fresh = await runtime.prepareEdit(tasks.edits.notes(target));
	assert.equal(reads, 2);
	assert.equal(fresh.etag, '"two"');
	assert.deepEqual(fresh.values, { notes });
	notes = "Changed without an event";
	token = '"three"';
	await runtime.saveEdit(fresh, { notes: "Another draft" }).result;
	const afterConflict = await runtime.prepareEdit(tasks.edits.notes(target));
	assert.equal(reads, 3);
	assert.equal(afterConflict.etag, '"three"');
	assert.deepEqual(afterConflict.values, { notes });
});

test("a late task response cannot pair an old token with newer confirmed notes", {
	timeout: 5000,
}, async (t) => {
	const started = deferred<void>(),
		pending = deferred<Response>();
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			createTaskDefinition(async () => {
				reads++;
				if (reads === 1) {
					started.resolve();
					return pending.promise;
				}
				return response("New confirmed notes", '"two"');
			}),
		],
	});
	t.after(() => runtime.close());
	const preparing = runtime.prepareEdit(tasks.edits.notes(target));
	await started.promise;
	runtime.observe({
		facts: [taskFact({ ...task, notes: "New confirmed notes" })],
	});
	pending.resolve(response());
	const result = await preparing.catch(() => undefined);
	if (result) {
		assert.equal(result.etag, '"two"');
		assert.deepEqual(result.values, { notes: "New confirmed notes" });
	} else {
		const reloaded = await runtime.prepareEdit(tasks.edits.notes(target));
		assert.equal(reloaded.etag, '"two"');
		assert.deepEqual(reloaded.values, { notes: "New confirmed notes" });
	}
	assert.equal(reads, 2);
});
