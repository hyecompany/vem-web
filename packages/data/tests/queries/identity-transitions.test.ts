// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { ReadModelProjection } from "../../src/read-model/projection.js";
import {
	applyReadModel,
	emptyReadModel,
	readModelDelta,
} from "../../src/read-model/publication.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";
import { fact, options, resource, tick } from "../support/scenario.js";

const get = (runtime: Runtime, identity: string) =>
	runtime
		.readModelSnapshot()
		.records.find((entry) => entry.confirmed?.identity === identity)?.confirmed;
const detail = (identity: string) =>
	query({ resource: "things", mode: "one", identity, select: ["name"] });
const transition = (from: string, to: string, basis = ["read"]) => ({
	resource: "things",
	from,
	to,
	basis,
});

test("explicit renames survive absence and coalesced chains without becoming name aliases", (t) => {
	const definition = resource();
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	runtime.observe({
		facts: [fact("a", { name: "A", private: "not transferred" })],
	});
	const selected = runtime.watch(detail("a"));
	const incarnation = selected.getSnapshot().incarnation;
	assert.ok(incarnation);
	const rowIdentity = selected.getSnapshot().rows[0]?.identity;
	assert.equal(
		rowIdentity?.kind === "resource" && rowIdentity.incarnation,
		incarnation,
	);
	const before = runtime.readModelSnapshot();
	runtime.observe({
		identityTransitions: [transition("a", "b"), transition("b", "c")],
	});
	const result = selected.getSnapshot();
	assert.equal(result.exists, false);
	assert.equal(result.rows.length, 0);
	assert.deepEqual(
		result.identityTransitions?.map((entry) => [
			entry.from.identity,
			entry.to.identity,
		]),
		[["a", "c"]],
	);
	assert.equal(result.identityTransitions?.[0]?.from.incarnation, incarnation);
	assert.deepEqual(get(runtime, "c")?.values, {});
	runtime.observe({ facts: [fact("a", { name: "New A" })] });
	const reused = selected.getSnapshot();
	assert.notEqual(reused.incarnation, incarnation);
	assert.equal(reused.identityTransitions?.[0]?.from.incarnation, incarnation);
	assert.notEqual(
		reused.identityTransitions?.[0]?.from.incarnation,
		reused.incarnation,
	);
	const after = runtime.readModelSnapshot();
	const transported = applyReadModel(
		before,
		structuredClone(readModelDelta(before, after, false)),
		false,
	);
	const replica = new ReadModelProjection([definition]);
	replica.setSnapshot(transported, runtime.accessSnapshot(), []);
	assert.deepEqual(replica.project(detail("a")), reused);
	assert.deepEqual(
		applyReadModel(
			emptyReadModel(),
			structuredClone(readModelDelta(before, after, true)),
			true,
		),
		after,
	);
});

test("deletion and regrant cannot replay an earlier resource incarnation", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { name: "A" })] });
	const before = runtime.watch(detail("a")).getSnapshot().incarnation;
	runtime.observe({ identityTransitions: [transition("a", "b")] });
	runtime.observe({ facts: [{ ...fact("b", {}), presence: "absent" }] });
	assert.equal(
		runtime.watch(detail("a")).getSnapshot().identityTransitions?.[0]?.from
			.incarnation,
		before,
	);
	runtime.observe({ facts: [fact("b", { name: "New B" })] });
	assert.equal(
		runtime.watch(detail("a")).getSnapshot().identityTransitions,
		undefined,
	);
	runtime.setAccess({ decisions: [{ scope: "read", state: "denied" }] });
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	runtime.observe({ facts: [fact("a", { name: "Another A" })] });
	assert.notEqual(runtime.watch(detail("a")).getSnapshot().incarnation, before);
	assert.equal(runtime.readModelSnapshot().identityTransitions, undefined);
});

test("independent disclosure supports survive selectively and renames grant no target access", (t) => {
	const definition = resource({
		access: (descriptor) => (descriptor.identity === "b" ? "new-name" : "read"),
		fieldAccess: {
			$presence: (identity) => (identity === "b" ? "new-name" : "read"),
		},
	});
	const runtime = createRuntime({
		...options(definition),
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "events", state: "allowed" },
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { name: "A" })] });
	runtime.observe({
		identityTransitions: [transition("a", "b", ["public", "events"])],
	});
	runtime.setAccess({ decisions: [{ scope: "events", state: "denied" }] });
	assert.equal(runtime.readModelSnapshot().identityTransitions?.length, 1);
	assert.equal(runtime.access("new-name"), "unknown");
	assert.equal(runtime.watch(detail("b")).getSnapshot().rows.length, 0);
	assert.equal(
		runtime.watch(detail("a")).getSnapshot().identityTransitions,
		undefined,
	);
});

test("event gaps break identity continuity instead of guessing through name reuse", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	const feed = { channel: "events" };
	runtime.setContinuity(feed, "live");
	runtime.observe({ facts: [{ ...fact("a", { name: "A" }), liveness: feed }] });
	const selected = runtime.watch(detail("a"));
	const original = selected.getSnapshot().incarnation;
	runtime.setContinuity(feed, "interrupted");
	assert.notEqual(selected.getSnapshot().incarnation, original);
	runtime.setContinuity(feed, "live");
	runtime.observe({
		identityTransitions: [{ ...transition("a", "b"), liveness: feed }],
	});
	assert.notEqual(
		selected.getSnapshot().identityTransitions?.[0]?.from.incarnation,
		original,
	);
});

test("obsolete acquisition cannot rename or fill a newly reused identity", async (t) => {
	const response = deferred<ObservationBatch>();
	let reading = 0;
	const definition = resource({
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				run: async () => {
					reading++;
					return reading === 1 ? response.promise : undefined;
				},
			},
		],
	});
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", {})] });
	const selected = runtime.watch(detail("a"));
	const pending = selected.retry();
	while (reading === 0) await tick();
	runtime.observe({ identityTransitions: [transition("a", "b")] });
	runtime.observe({ facts: [fact("a", { name: "Replacement" })] });
	response.resolve({
		identityTransitions: [transition("a", "obsolete")],
		relationships: [
			{
				resource: "things",
				identity: "a",
				relationship: "links",
				targets: [{ resource: "things", identity: "b" }],
				complete: true,
				basis: ["read"],
			},
		],
		memberships: [
			{
				resource: "things",
				scope: "old",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
		facts: [fact("a", { name: "Old", extra: "Old private data" })],
	});
	await pending;
	assert.equal(get(runtime, "obsolete"), undefined);
	assert.equal(runtime.relationship("things", "a", "links"), undefined);
	assert.notEqual(runtime.membership("things", "old")?.complete, true);
	assert.ok(!runtime.membership("things", "old")?.identities.includes("a"));
	assert.deepEqual(get(runtime, "a")?.values, { name: "Replacement" });
});

test("late transitions from a revoked acquisition stay withdrawn after regrant", async (t) => {
	const response = deferred<ObservationBatch>();
	let reading = 0;
	const definition = resource({
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				run: async () => {
					reading++;
					return reading === 1 ? response.promise : undefined;
				},
			},
		],
	});
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", {})] });
	const pending = runtime.watch(detail("a")).retry();
	while (reading === 0) await tick();
	runtime.setAccess({ decisions: [{ scope: "read", state: "denied" }] });
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	response.resolve({ identityTransitions: [transition("a", "b")] });
	await pending;
	assert.equal(runtime.readModelSnapshot().identityTransitions, undefined);
	assert.equal(get(runtime, "b"), undefined);
});

test("transition retention is bounded and never pretends an evicted chain is complete", (t) => {
	const runtime = createRuntime(options());
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("0", { name: "Start" })] });
	runtime.observe({
		identityTransitions: Array.from({ length: 520 }, (_, i) =>
			transition(String(i), String(i + 1)),
		),
	});
	assert.equal(runtime.readModelSnapshot().identityTransitions?.length, 512);
	assert.equal(
		runtime.watch(detail("0")).getSnapshot().identityTransitions,
		undefined,
	);
	assert.equal(
		runtime.watch(detail("8")).getSnapshot().identityTransitions?.[0]?.to
			.identity,
		"520",
	);
});
