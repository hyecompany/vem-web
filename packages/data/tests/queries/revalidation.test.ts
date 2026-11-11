// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { queryView } from "../../src/react.js";
import { ReadModelProjection } from "../../src/read-model/projection.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type {
	ObservationBatch,
	QueryDescriptor,
	QueryResult,
	ResourceDefinition,
} from "../../src/types.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let index = 0; index < 100 && !predicate(); index++) await tick();
	assert.ok(predicate(), "Expected acquisition state");
}
const ref = { resource: "tasks", identity: "walk" };
const fact = (values: Record<string, unknown>) => ({
	...ref,
	values,
	presence: "present" as const,
	basis: ["public"],
});
const detail = (select: readonly string[]) =>
	query({ ...ref, mode: "one", select });
const membership = {
	resource: "tasks",
	identities: ["walk"],
	complete: true,
	basis: ["public"],
};
function replica(
	runtime: Runtime,
	definitions: readonly ResourceDefinition[],
	descriptor: QueryDescriptor,
	result: QueryResult,
) {
	const projection = new ReadModelProjection(definitions);
	projection.setSnapshot(
		runtime.readModelSnapshot(),
		runtime.accessSnapshot(),
		runtime.listActivities(),
	);
	const projected = projection.project(descriptor, {
		fetching: result.fetching,
		revalidating: result.revalidating,
		settled: result.settled,
		issues: result.issues.filter((issue) => issue.kind !== "access"),
	});
	assert.deepEqual({ ...projected, revision: 0 }, { ...result, revision: 0 });
}

test("held repair retains values, failure stops revalidating, and retry replaces the evidence", async (t) => {
	let gate = deferred<ObservationBatch>(),
		reads = 0;
	const definition: ResourceDefinition = {
		name: "tasks",
		access: "public",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["title"],
				run: async () => {
					reads++;
					return gate.promise;
				},
			},
		],
	};
	const runtime = createRuntime({ resources: [definition] });
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact({ title: "Pack a picnic" })] });
	const descriptor = detail(["title"]);
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => {}));
	assert.equal(handle.getSnapshot().stale, false);
	assert.equal(handle.getSnapshot().revalidating, false);
	runtime.observe({ invalidate: [{ ...ref, field: "title" }] });
	await until(() => reads === 1);
	let result = handle.getSnapshot();
	assert.equal(result.rows[0]?.data.title, "Pack a picnic");
	assert.equal(result.rows[0]?.complete, true);
	assert.equal(result.stale, true);
	assert.equal(result.revalidating, true);
	assert.equal(queryView(result), "content");
	replica(runtime, [definition], descriptor, result);
	gate.reject(new Error("Service offline"));
	await until(() => handle.getSnapshot().settled);
	result = handle.getSnapshot();
	assert.equal(result.stale, true);
	assert.equal(result.revalidating, false);
	assert.equal(result.fetching, false);
	assert.equal(result.rows[0]?.data.title, "Pack a picnic");
	assert.equal(result.issues[0]?.message, "Service offline");
	replica(runtime, [definition], descriptor, result);
	gate = deferred<ObservationBatch>();
	const retried = handle.retry();
	await until(() => reads === 2);
	assert.equal(handle.getSnapshot().revalidating, true);
	gate.resolve({ facts: [fact({ title: "Bring lunch" })] });
	result = await retried;
	assert.equal(result.rows[0]?.data.title, "Bring lunch");
	assert.equal(result.stale, false);
	assert.equal(result.revalidating, false);
});

test("stale filter evidence remains unconfirmed content even when the filter field is not selected", async (t) => {
	const gate = deferred<ObservationBatch>();
	const definition: ResourceDefinition = {
		name: "tasks",
		access: "public",
		sources: [
			{
				key: "status",
				mode: "one",
				fields: ["status"],
				run: () => gate.promise,
			},
		],
	};
	const runtime = createRuntime({ resources: [definition] });
	t.after(() => runtime.close());
	runtime.observe({
		facts: [fact({ title: "Pack a picnic", status: "open" })],
		memberships: [membership],
	});
	const descriptor = query({
		resource: "tasks",
		mode: "list",
		select: ["title"],
		where: { status: "open" },
	});
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => {}));
	runtime.observe({ invalidate: [{ ...ref, field: "status" }] });
	await until(() => handle.getSnapshot().fetching);
	const result = handle.getSnapshot();
	assert.equal(result.rows.length, 0);
	assert.equal(result.unresolved[0]?.data.title, "Pack a picnic");
	assert.equal(
		Object.hasOwn(result.unresolved[0]?.fields ?? {}, "status"),
		false,
	);
	assert.equal(result.confirmed.knownCount, 0);
	assert.equal(result.stale, true);
	assert.equal(result.revalidating, true);
	assert.equal(queryView(result), "content");
	replica(runtime, [definition], descriptor, result);
	gate.resolve({ facts: [fact({ status: "closed" })] });
	await until(() => handle.getSnapshot().settled);
	assert.equal(handle.getSnapshot().empty, true);
	assert.equal(handle.getSnapshot().stale, false);
});

test("membership-only gaps are stale without making unchanged display fields stale", async (t) => {
	const gate = deferred<ObservationBatch>();
	const definition: ResourceDefinition = {
		name: "tasks",
		access: "public",
		sources: [
			{
				key: "membership",
				mode: "list",
				fields: [],
				membership: true,
				run: () => gate.promise,
			},
		],
	};
	const runtime = createRuntime({ resources: [definition] });
	t.after(() => runtime.close());
	runtime.observe({
		facts: [fact({ title: "Pack a picnic" })],
		memberships: [membership],
	});
	const descriptor = query({
		resource: "tasks",
		mode: "list",
		select: ["title"],
	});
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => {}));
	runtime.observe({ invalidateMemberships: [{ resource: "tasks" }] });
	await until(() => handle.getSnapshot().fetching);
	const result = handle.getSnapshot();
	assert.equal(result.rows[0]?.data.title, "Pack a picnic");
	assert.equal(result.rows[0]?.fields.title?.stale, undefined);
	assert.equal(result.confirmed.complete, false);
	assert.equal(result.stale, true);
	assert.equal(result.revalidating, true);
	replica(runtime, [definition], descriptor, result);
	gate.resolve({ memberships: [membership] });
	await until(() => handle.getSnapshot().settled);
	assert.equal(handle.getSnapshot().stale, false);
});

test("missing-only work does not claim to revalidate an unsupported stale field", async (t) => {
	const gate = deferred<ObservationBatch>();
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: "public",
				sources: [
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						run: () => gate.promise,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact({ title: "Pack a picnic" })] });
	const missing = runtime.watch(detail(["title", "notes"]));
	assert.equal(missing.getSnapshot().stale, false);
	assert.equal(
		missing.getSnapshot().rows[0]?.fields.title?.liveness,
		"snapshot",
	);
	runtime.observe({ invalidate: [{ ...ref, field: "title" }] });
	t.after(missing.subscribe(() => {}));
	await until(() => missing.getSnapshot().fetching);
	assert.equal(missing.getSnapshot().stale, true);
	assert.equal(missing.getSnapshot().revalidating, false);
	gate.resolve({ facts: [fact({ notes: "Bring water" })] });
	await until(() => missing.getSnapshot().settled);
	assert.equal(missing.getSnapshot().stale, true);
	assert.equal(missing.getSnapshot().revalidating, false);
});

test("permission withdrawal removes protected old values while a repair is pending", async (t) => {
	const gate = deferred<ObservationBatch>();
	const runtime = createRuntime({
		access: [{ scope: "private", state: "allowed" }],
		resources: [
			{
				name: "tasks",
				access: "public",
				fieldAccess: { notes: "private" },
				sources: [
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						access: "private",
						run: () => gate.promise,
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			fact({ title: "Pack a picnic" }),
			{ ...fact({ notes: "Protected notes" }), basis: ["private"] },
		],
	});
	const handle = runtime.watch(detail(["title", "notes"]));
	t.after(handle.subscribe(() => {}));
	runtime.observe({ invalidate: [{ ...ref, field: "notes" }] });
	await until(() => handle.getSnapshot().revalidating);
	runtime.revoke("private");
	assert.equal(handle.getSnapshot().rows[0]?.data.title, "Pack a picnic");
	assert.equal(handle.getSnapshot().rows[0]?.data.notes, undefined);
	assert.equal(handle.getSnapshot().stale, false);
	assert.equal(handle.getSnapshot().revalidating, false);
	gate.resolve({
		facts: [{ ...fact({ notes: "Late protected notes" }), basis: ["private"] }],
	});
	await tick();
	assert.equal(
		JSON.stringify(handle.getSnapshot()).includes("protected notes"),
		false,
	);
});

test("a shared dependency read revalidates both a derived field and a joining consumer", async (t) => {
	const gate = deferred<ObservationBatch>();
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: "public",
				sources: [
					{
						key: "count",
						mode: "one",
						fields: ["count"],
						run: async () => {
							reads++;
							return gate.promise;
						},
					},
				],
				fieldDependencies: {
					total: (identity) => [
						query({
							resource: "tasks",
							identity,
							mode: "one",
							select: ["count"],
						}),
					],
				},
				derive: (_changed, context) => {
					const record = context.get("tasks", "walk");
					if (!record?.fields.count || record.fields.count.stale) return;
					return {
						facts: [
							{
								...fact({ total: Number(record.values.count) * 2 }),
								dependsOn: [{ ...ref, field: "count" }],
							},
						],
					};
				},
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact({ count: 2 })] });
	const total = runtime.watch(detail(["total"]));
	t.after(total.subscribe(() => {}));
	assert.equal(total.getSnapshot().rows[0]?.data.total, 4);
	runtime.observe({ invalidate: [{ ...ref, field: "count" }] });
	await until(() => reads === 1);
	assert.equal(total.getSnapshot().stale, true);
	assert.equal(total.getSnapshot().revalidating, true);
	const count = runtime.watch(detail(["count"]));
	t.after(count.subscribe(() => {}));
	await until(() => count.getSnapshot().fetching);
	assert.equal(reads, 1);
	assert.equal(count.getSnapshot().revalidating, true);
	assert.equal(total.getSnapshot().revalidating, true);
	gate.resolve({ facts: [fact({ count: 3 })] });
	await until(() => total.getSnapshot().settled && count.getSnapshot().settled);
	assert.equal(total.getSnapshot().rows[0]?.data.total, 6);
	assert.equal(total.getSnapshot().stale, false);
	assert.equal(total.getSnapshot().revalidating, false);
});

test("stale prior emptiness and absence remain readable evidence without a current empty claim", async (t) => {
	const gate = deferred<ObservationBatch>();
	const definition: ResourceDefinition = {
		name: "tasks",
		access: "private",
		sources: [
			{
				key: "list",
				mode: "list",
				fields: [],
				membership: true,
				run: () => gate.promise,
			},
			{ key: "one", mode: "one", fields: [], run: () => gate.promise },
		],
	};
	const runtime = createRuntime({
		resources: [definition],
		access: [{ scope: "private", state: "allowed" }],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [{ ...ref, presence: "absent", basis: ["private"] }],
		memberships: [{ ...membership, identities: [], basis: ["private"] }],
	});
	const list = runtime.watch(
		query({ resource: "tasks", mode: "list", select: [] }),
	);
	const absent = runtime.watch(detail([]));
	assert.equal(list.getSnapshot().empty, true);
	assert.equal(absent.getSnapshot().exists, false);
	runtime.observe({
		invalidate: [{ ...ref, field: "$presence" }],
		invalidateMemberships: [{ resource: "tasks" }],
	});
	for (const handle of [list, absent]) {
		assert.equal(handle.getSnapshot().empty, false);
		assert.equal(handle.getSnapshot().stale, true);
		assert.equal(handle.getSnapshot().revalidating, false);
		assert.equal(queryView(handle.getSnapshot()), "content");
		t.after(handle.subscribe(() => {}));
	}
	await until(
		() => list.getSnapshot().revalidating && absent.getSnapshot().revalidating,
	);
	runtime.revoke("private");
	for (const handle of [list, absent]) {
		assert.equal(handle.getSnapshot().stale, false);
		assert.equal(handle.getSnapshot().revalidating, false);
		assert.equal(queryView(handle.getSnapshot()), "restricted");
	}
	gate.resolve({});
});

test("independent current filter and membership evidence avoids a false stale result", () => {
	const runtime = createRuntime({
		resources: [{ name: "tasks", access: "public" }],
	});
	try {
		const feed = { channel: "tasks" };
		runtime.setContinuity(feed, "live");
		runtime.observe({
			facts: [
				fact({ title: "Pack a picnic" }),
				{ ...fact({ status: "open" }), liveness: feed },
			],
			memberships: [
				{ ...membership, liveness: feed },
				{ ...membership, where: { status: "open" }, liveness: "immutable" },
			],
		});
		runtime.setContinuity(feed, "interrupted");
		const result = runtime
			.watch(
				query({
					resource: "tasks",
					mode: "list",
					select: ["title"],
					where: { status: "open" },
				}),
			)
			.getSnapshot();
		assert.equal(result.rows[0]?.data.title, "Pack a picnic");
		assert.equal(result.confirmed.complete, true);
		assert.equal(result.stale, false);
		assert.equal(result.revalidating, false);
	} finally {
		runtime.close();
	}
});

for (const kind of ["field", "membership"] as const)
	test(`invalidating unavailable ${kind} evidence gives the planner a new acquisition generation`, async (t) => {
		let reads = 0;
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					access: "public",
					sources: [
						{
							key: kind,
							mode: kind === "field" ? "one" : "list",
							fields: kind === "field" ? ["title"] : [],
							membership: kind === "membership",
							run: async () => {
								reads++;
								if (reads === 1) return;
								return kind === "field"
									? { facts: [fact({ title: "Now available" })] }
									: { memberships: [{ ...membership, identities: [] }] };
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		const handle = runtime.watch(
			kind === "field"
				? detail(["title"])
				: query({ resource: "tasks", mode: "list", select: [] }),
		);
		t.after(handle.subscribe(() => {}));
		await until(() => reads === 1 && handle.getSnapshot().settled);
		runtime.observe(
			kind === "field"
				? { invalidate: [{ ...ref, field: "title" }] }
				: { invalidateMemberships: [{ resource: "tasks" }] },
		);
		await until(() => reads === 2 && handle.getSnapshot().settled);
		if (kind === "field")
			assert.equal(handle.getSnapshot().rows[0]?.data.title, "Now available");
		else assert.equal(handle.getSnapshot().empty, true);
	});
