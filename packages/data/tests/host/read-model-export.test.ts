// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command } from "../../src/descriptors.js";
import {
	applyReadModel,
	emptyReadModel,
	readModelChanges,
	readModelDelta,
} from "../../src/read-model/publication.js";
import type { ReadModelSnapshot } from "../../src/read-model/types.js";
import { KnowledgeStore } from "../../src/runtime/knowledge.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ActionOutcome } from "../../src/types.js";
import { fact, options, resource, tick } from "../support/scenario.js";

const continuity = { channel: "test-events" };

test("one record update validates only its own fields and shares the publication delta", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	runtime.observe({
		facts: Array.from({ length: 100 }, (_, index) =>
			fact(String(index), { name: `Task ${index}`, status: "open" }),
		),
	});
	const before = runtime.readModelSnapshot();
	let validations = 0;
	const valid = KnowledgeStore.prototype.valid;
	t.mock.method(
		KnowledgeStore.prototype,
		"valid",
		function (this: KnowledgeStore, ...args: Parameters<typeof valid>) {
			validations++;
			return valid.apply(this, args);
		},
	);
	runtime.observe({ facts: [fact("0", { status: "done" })] });
	const after = runtime.readModelSnapshot();
	assert.ok(
		validations <= 6,
		`Validated ${validations} cells for one changed record`,
	);
	assert.equal(after.records[1], before.records[1]);
	const update = readModelChanges(before, after);
	assert.ok(update);
	assert.equal(update.records.upsert.length, 1);
	assert.deepEqual(update.records.remove, []);
	assert.equal(readModelDelta(before, after, false), update);
	const tab = applyReadModel(before, update, false);
	assert.deepEqual(tab, after);
	assert.equal(readModelChanges(before, tab), update);

	// Reobserved presence changes the evidence revision without changing its value.
	runtime.observe({ facts: [fact("0", { status: "done" })] });
	const reobserved = runtime.readModelSnapshot();
	assert.equal(reobserved.records[0]?.confirmed, after.records[0]?.confirmed);
	assert.notEqual(reobserved.records[0], after.records[0]);
	assert.ok(
		(reobserved.records[0]?.facts.$presence?.revision ?? 0) >
			(after.records[0]?.facts.$presence?.revision ?? 0),
	);
});

test("missing field invalidations and replacement withdrawals are exported incrementally", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { name: "A", notes: "Remember" })] });
	const before = runtime.readModelSnapshot();
	runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "missing" }],
	});
	const invalidated = runtime.readModelSnapshot();
	assert.equal(invalidated.records[0]?.confirmed, before.records[0]?.confirmed);
	assert.ok(invalidated.records[0]?.facts.missing);
	assert.equal(readModelChanges(before, invalidated)?.records.upsert.length, 1);
	runtime.observe({ facts: [{ ...fact("a", {}), replace: ["notes"] }] });
	const replaced = runtime.readModelSnapshot();
	assert.equal(replaced.records[0]?.confirmed?.values.notes, undefined);
	assert.ok(replaced.records[0]?.facts.notes);
	assert.ok(replaced.records[0]?.facts.missing);
	assert.deepEqual(
		applyReadModel(
			invalidated,
			readModelDelta(invalidated, replaced, false),
			false,
		),
		replaced,
	);
});

test("access withdrawal removes records and membership while retaining independent information", (t) => {
	const runtime = createRuntime(options(resource({ access: undefined })));
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			fact("private", { name: "Secret" }),
			{
				...fact("mixed", { name: "Public", notes: "Private" }),
				basis: ["public"],
				fieldBasis: { notes: ["read"] },
			},
		],
		memberships: [
			{
				resource: "things",
				identities: ["private", "mixed"],
				complete: true,
				basis: ["read"],
				liveness: continuity,
			},
		],
	});
	const before = runtime.readModelSnapshot();
	runtime.revoke("read");
	const after = runtime.readModelSnapshot();
	assert.equal(after.records.length, 1);
	assert.deepEqual(after.records[0]?.confirmed?.values, { name: "Public" });
	assert.equal(after.memberships.length, 0);
	const update = readModelChanges(before, after);
	assert.ok(update);
	assert.equal(update.records.remove.length, 1);
	assert.equal(update.records.upsert.length, 1);
	assert.equal(update.memberships.remove.length, 1);
	assert.deepEqual(applyReadModel(before, update, false), after);
	assert.equal(JSON.stringify(update).includes("Secret"), false);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(
		runtime.readModelSnapshot().records[0]?.confirmed?.values.notes,
		undefined,
	);
});

test("proposal-only publications and their removal carry exact changes without new observations", async (t) => {
	const outcome = deferred<ActionOutcome>();
	const definition = resource({
		commands: {
			create: {
				access: () => "read",
				disclosure: () => "read",
				project: () => [
					{
						resource: "things",
						kind: "create",
						retainOnFailure: false,
						values: { name: "Proposed" },
						basis: ["read"],
					},
				],
				run: () => outcome.promise,
			},
		},
	});
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	await runtime.ready;
	let previous = runtime.readModelSnapshot();
	const publications: [ReadModelSnapshot, ReadModelSnapshot][] = [];
	const stop = runtime.subscribe(() => {
		const next = runtime.readModelSnapshot();
		publications.push([previous, next]);
		previous = next;
	});
	t.after(stop);
	const action = runtime.run(
		command({ resource: "things", name: "create", input: {} }),
	);
	await tick();
	assert.ok(runtime.readModelSnapshot().records[0]?.effective?.proposal);
	outcome.resolve({ kind: "failed", error: { message: "Rejected" } });
	await action.result;
	assert.ok(
		publications.some(
			([before, after]) =>
				(readModelChanges(before, after)?.records.remove.length ?? 0) > 0,
		),
	);
	for (const [before, after] of publications) {
		const changes = readModelChanges(before, after);
		assert.ok(changes, "Every publication retains its exact changes");
		assert.deepEqual(applyReadModel(before, changes, false), after);
	}
	assert.equal(runtime.readModelSnapshot().records.length, 0);
});

test("missed publications fall back to a complete diff and reset discards old contents", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { name: "A" })] });
	const first = runtime.readModelSnapshot();
	runtime.observe({ facts: [fact("b", { name: "B" })] });
	runtime.observe({ facts: [fact("a", { name: "Updated" })] });
	const last = runtime.readModelSnapshot();
	assert.equal(readModelChanges(first, last), undefined);
	const skipped = readModelDelta(first, last, false);
	assert.deepEqual(applyReadModel(first, skipped, false), last);
	const reset = readModelDelta(last, first, true);
	const restored = applyReadModel(last, reset, true);
	assert.deepEqual(restored, first);
	assert.equal(readModelChanges(last, restored), undefined);
	assert.deepEqual(
		applyReadModel(last, readModelDelta(last, emptyReadModel(), true), true),
		emptyReadModel(),
	);
});

test("continuity-only evidence revisions survive a historical field invalidation", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	runtime.setContinuity(continuity, "live");
	runtime.observe({
		facts: [
			{
				resource: "things",
				identity: "a",
				values: { name: "A" },
				basis: ["read"],
				liveness: { all: [continuity, "snapshot"] },
			},
		],
	});
	runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "name" }],
	});
	const before = runtime.readModelSnapshot();
	runtime.setContinuity(continuity, "interrupted");
	const after = runtime.readModelSnapshot();
	assert.equal(after.records[0]?.confirmed, before.records[0]?.confirmed);
	assert.equal(after.records[0]?.effective, before.records[0]?.effective);
	assert.ok(
		(after.records[0]?.facts.name?.currencyRevision ?? 0) >
			(before.records[0]?.facts.name?.currencyRevision ?? 0),
	);
	assert.equal(readModelChanges(before, after)?.records.upsert.length, 1);
});
