// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query, stableKey } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { QueryProjection } from "../../src/read-model/query-projector.js";
import type { Runtime } from "../../src/runtime.js";
import type { QueryDescriptor } from "../../src/types.js";
import { fact } from "../support/acquisition.js";

const names = query({ resource: "tasks", mode: "list", select: [] });
const open = query({
	resource: "tasks",
	mode: "list",
	select: [],
	where: { status: "open" },
});

function population(runtime: Runtime, descriptor = names) {
	const snapshot = runtime.readModelSnapshot();
	const records = snapshot.records.flatMap((record) =>
		record.confirmed ? [record.confirmed] : [],
	);
	const recordKey = (resource: string, identity: unknown) =>
		`${resource}:${stableKey(identity)}`;
	return new QueryProjection({
		definition: (resource) => ({ name: resource }),
		recordKey,
		factKey: (ref) =>
			`${recordKey(ref.resource, ref.identity)}:${JSON.stringify(ref.field)}`,
		access: (scope) => runtime.access(scope),
		revision: () => snapshot.revision,
		records: new Map(records.map((record) => [record.key, record])),
		resourceRecords: new Map([
			["tasks", new Set(records.map((record) => record.key))],
		]),
		memberships: () => snapshot.memberships,
		cells: new Map(
			snapshot.records.flatMap((record) =>
				Object.entries(record.facts).map(([field, value]) => [
					`${record.key}:${JSON.stringify(field)}`,
					value,
				]),
			),
		),
		invalidations: new Map(),
		activities: () => [],
		effective: () => undefined,
		effectiveRecords: () => [],
	}).population(descriptor as QueryDescriptor);
}

test("population distinguishes unknown totals, bounded matches, and complete known counts", (t) => {
	const runtime = createRuntime({ resources: [{ name: "tasks" }] });
	t.after(() => runtime.close());
	assert.deepEqual(population(runtime), {
		kind: "unknown",
		minimum: 0,
		evidence: "historical",
	});
	runtime.observe({
		facts: [
			fact("a", { status: "open" }),
			fact("b", { status: "closed" }),
			fact("c", {}),
		],
		memberships: [
			{
				resource: "tasks",
				identities: ["a", "b", "c"],
				complete: false,
				basis: ["public"],
			},
		],
	});
	assert.deepEqual(population(runtime), {
		kind: "unknown",
		minimum: 3,
		evidence: "historical",
	});
	runtime.observe({
		memberships: [
			{
				resource: "tasks",
				identities: ["a", "b", "c"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	assert.deepEqual(population(runtime), {
		kind: "known",
		count: 3,
		evidence: "current",
	});
	assert.deepEqual(population(runtime, open), {
		kind: "bounded",
		minimum: 1,
		maximum: 2,
		evidence: "current",
	});
	runtime.observe({
		memberships: [
			{
				resource: "tasks",
				where: open.where,
				identities: ["a", "c"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	assert.deepEqual(population(runtime, open), {
		kind: "known",
		count: 2,
		evidence: "current",
	});
	assert.deepEqual(population(runtime, query({ ...names, scope: "another" })), {
		kind: "unknown",
		minimum: 3,
		evidence: "historical",
	});
});

test("population marks interrupted inventories and stale filter evidence as historical without using display fields", (t) => {
	const runtime = createRuntime({ resources: [{ name: "tasks" }] });
	t.after(() => runtime.close());
	const feed = { channel: "tasks" };
	runtime.setContinuity(feed, "live");
	runtime.observe({
		facts: [
			fact("a", { status: "open", notes: "Earlier notes" }),
			fact("b", { status: "closed" }),
		],
		memberships: [
			{
				resource: "tasks",
				identities: ["a", "b"],
				complete: true,
				basis: ["public"],
				liveness: feed,
			},
		],
	});
	runtime.observe({
		invalidate: [{ resource: "tasks", identity: "a", field: "notes" }],
	});
	assert.deepEqual(population(runtime, open), {
		kind: "known",
		count: 1,
		evidence: "current",
	});
	runtime.observe({
		invalidate: [{ resource: "tasks", identity: "a", field: "status" }],
	});
	assert.deepEqual(population(runtime, open), {
		kind: "bounded",
		minimum: 0,
		maximum: 1,
		evidence: "historical",
	});
	assert.deepEqual(population(runtime), {
		kind: "known",
		count: 2,
		evidence: "current",
	});
	runtime.observe({
		invalidate: [{ resource: "tasks", identity: "a", field: "$presence" }],
	});
	assert.deepEqual(population(runtime), {
		kind: "known",
		count: 2,
		evidence: "historical",
	});
	runtime.setContinuity(feed, "interrupted");
	assert.deepEqual(population(runtime), {
		kind: "known",
		count: 2,
		evidence: "historical",
	});
	assert.equal(runtime.membership("tasks")?.complete, false);
});

test("withdrawing complete support removes its estimate while independently permitted facts survive", (t) => {
	const runtime = createRuntime({
		access: [{ scope: "inventory", state: "allowed" }],
		resources: [{ name: "tasks" }],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [fact("a", {})],
		memberships: [
			{
				resource: "tasks",
				identities: ["a"],
				complete: true,
				basis: ["inventory"],
			},
		],
	});
	runtime.observe({
		memberships: [
			{
				resource: "tasks",
				identities: ["a"],
				complete: false,
				basis: ["public"],
			},
		],
	});
	assert.deepEqual(population(runtime), {
		kind: "known",
		count: 1,
		evidence: "current",
	});
	runtime.revoke("inventory");
	assert.deepEqual(population(runtime), {
		kind: "unknown",
		minimum: 1,
		evidence: "historical",
	});
});
