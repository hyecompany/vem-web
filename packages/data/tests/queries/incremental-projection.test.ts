// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { ReadModelProjection } from "../../src/read-model/projection.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type {
	QueryDescriptor,
	QueryResult,
	ResourceDefinition,
} from "../../src/types.js";
import { fact, options, resource, tick } from "../support/scenario.js";

test("active queries evaluate changed records and retain unchanged rows and snapshots", (t) => {
	let matches = 0;
	const definition = resource({
		matches: (values, where) => {
			matches++;
			return values.status === where.status;
		},
	});
	const runtime = createRuntime(options(definition));
	t.after(() => runtime.close());
	runtime.observe({
		facts: Array.from({ length: 256 }, (_, index) =>
			fact(String(index), {
				name: `Task ${index}`,
				status: index % 4,
				notes: "Original",
			}),
		),
		memberships: [
			{
				resource: "things",
				identities: Array.from({ length: 256 }, (_, index) => String(index)),
				complete: true,
				basis: ["read"],
			},
		],
	});
	const projection = new ReadModelProjection([definition]);
	const sync = () =>
		projection.setSnapshot(
			runtime.readModelSnapshot(),
			runtime.accessSnapshot(),
			runtime.listActivities(),
		);
	const queries = Array.from({ length: 4 }, (_, status) =>
		query({
			resource: "things",
			mode: "list",
			select: ["name", "status"],
			where: { status },
		}),
	);
	sync();
	const before = queries.map((descriptor) => projection.project(descriptor));
	matches = 0;
	runtime.observe({ facts: [fact("0", { notes: "Unselected change" })] });
	sync();
	for (const [index, descriptor] of queries.entries())
		assert.equal(projection.project(descriptor), before[index]);
	assert.ok(
		matches <= queries.length * 2,
		"one changed record is evaluated once for confirmed facts and once for presentation per query",
	);
	matches = 0;
	runtime.observe({ facts: [fact("0", { status: 1 })] });
	sync();
	const after = queries.map((descriptor) => projection.project(descriptor));
	assert.ok(matches <= queries.length * 2);
	assert.equal(after[0]?.rows.length, 63);
	assert.equal(after[1]?.rows.length, 65);
	assert.equal(after[2], before[2]);
	assert.equal(after[3], before[3]);
	assert.equal(
		after[0]?.rows[0],
		before[0]?.rows[1],
		"untouched row objects survive a neighboring row leaving",
	);
	const fresh = new ReadModelProjection([definition]);
	fresh.setSnapshot(
		runtime.readModelSnapshot(),
		runtime.accessSnapshot(),
		runtime.listActivities(),
	);
	for (const [index, descriptor] of queries.entries())
		assert.deepEqual(
			{ ...after[index], revision: 0 },
			{ ...fresh.project(descriptor), revision: 0 },
		);
});

test("incremental snapshots agree with fresh calculations through knowledge and access transitions", (t) => {
	const definition: ResourceDefinition = resource({
		queryDependencies: (descriptor) => Object.keys(descriptor.where ?? {}),
		inScope: (_identity, scope, values) =>
			values.project === undefined ? "unknown" : values.project === scope,
		fieldAccess: { secret: "secret" },
		matches: (values, where) =>
			values.status === undefined ? "unknown" : values.status === where.status,
	});
	const runtime = createRuntime({
		...options(definition),
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "secret", state: "allowed" },
		],
	});
	t.after(() => runtime.close());
	const queries: QueryDescriptor[] = [
		query({
			resource: "things",
			mode: "list",
			select: ["name", "secret"],
			orderBy: [{ field: "name", direction: "asc" }],
		}),
		query({
			resource: "things",
			mode: "list",
			select: ["name", "description", "secret"],
			where: { status: "running" },
		}),
		query({
			resource: "things",
			mode: "list",
			scope: "team",
			select: ["name"],
			where: { status: "running" },
		}),
		query({
			resource: "things",
			mode: "one",
			identity: "a",
			select: ["name", "status", "secret"],
		}),
	];
	const projection = new ReadModelProjection([definition]);
	const verify = () => {
		const model = runtime.readModelSnapshot(),
			access = runtime.accessSnapshot(),
			activities = runtime.listActivities();
		projection.setSnapshot(model, access, activities);
		const fresh = new ReadModelProjection([definition]);
		fresh.setSnapshot(model, access, activities);
		for (const descriptor of queries)
			assert.deepEqual(
				comparable(projection.project(descriptor), descriptor),
				comparable(fresh.project(descriptor), descriptor),
			);
	};
	runtime.observe({
		facts: [
			fact("a", { name: "Zebra", status: "running", project: "team" }),
			fact("b", { name: "Beta", status: "stopped", project: "team" }),
			fact("c", { name: "Cedar", status: "running", project: "other" }),
			{ ...fact("a", { secret: "Protected" }), basis: ["secret"] },
		],
		memberships: [
			{
				resource: "things",
				identities: ["a", "b", "c", "missing"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	verify();
	runtime.observe({ facts: [fact("b", { name: "Alpha", status: "running" })] });
	verify();
	const scoped = queries[2] as QueryDescriptor;
	assert.equal(projection.project(scoped).rows.length, 2);
	runtime.observe({ facts: [fact("b", { project: "other" })] });
	verify();
	assert.equal(
		projection.project(scoped).rows.length,
		1,
		"scope logic observes fields absent from the selection and declared dependencies",
	);
	runtime.observe({
		facts: [{ ...fact("a", { name: "Edited" }), replace: ["name", "status"] }],
	});
	verify();
	runtime.observe({
		invalidate: [
			{ resource: "things", identity: "b", field: "$presence" },
			{ resource: "things", identity: "c", field: "name" },
		],
	});
	verify();
	runtime.observe({ invalidateMemberships: [{ resource: "things" }] });
	verify();
	runtime.revoke("secret");
	verify();
	runtime.setAccess({ decisions: [{ scope: "secret", state: "allowed" }] });
	verify();
	assert.equal(
		projection.project(queries[3] as QueryDescriptor).rows[0]?.data.secret,
		undefined,
	);
	runtime.observe({
		facts: [{ ...fact("b", {}), presence: "absent" }],
		memberships: [
			{
				resource: "things",
				identities: ["a", "c"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	verify();
	runtime.observe({
		facts: [
			fact("b", { name: "Returned", status: "running", project: "team" }),
		],
	});
	verify();
});

// Queries without orderBy promise collection contents, not a particular insertion sequence.
function comparable(
	result: QueryResult,
	descriptor: QueryDescriptor,
): QueryResult {
	const byKey = (a: { key: string }, b: { key: string }) =>
		a.key.localeCompare(b.key);
	return {
		...result,
		revision: 0,
		rows: descriptor.orderBy ? result.rows : [...result.rows].sort(byKey),
		unresolved: [...result.unresolved].sort(byKey),
	};
}

test("sampling requirements remain distinct from ordinary selected fields across updates", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	let reads = 0;
	const runtime = createRuntime(
		options(
			resource({
				sources: [
					{
						key: "measurement",
						mode: "one",
						fields: ["cpu"],
						run: async () => ({ facts: [fact("a", { cpu: ++reads })] }),
					},
				],
			}),
		),
	);
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { name: "Task", cpu: 0 })] });
	const view = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "a",
			select: ["name"],
			sample: { fields: ["cpu"], intervalMs: 100 },
		}),
	);
	const stop = view.subscribe(() => {});
	await tick();
	assert.equal(reads, 0);
	for (let expected = 1; expected <= 2; expected++) {
		t.mock.timers.tick(100);
		await tick();
		await tick();
		assert.equal(reads, expected);
		assert.equal(view.getSnapshot().rows[0]?.data.name, "Task");
		assert.equal(view.getSnapshot().settled, true);
		assert.equal(view.getSnapshot().fetching, false);
		await view.retry();
		assert.equal(
			reads,
			expected,
			"ordinary retry does not reuse the forced sampling requirement",
		);
	}
	stop();
	t.mock.timers.tick(1000);
	await tick();
	assert.equal(reads, 2);
});

for (const maxConcurrent of [undefined, 1]) {
	test(`explicit sampling remains demanded while filtered membership is pending (${maxConcurrent ?? "browser scheduling"})`, async (t) => {
		t.mock.timers.enable({ apis: ["setInterval"] });
		const membership = deferred<void>();
		const calls: string[] = [];
		const comparison = { case: "insensitive", accents: "sensitive" } as const;
		const runtime = createRuntime({
			...options(
				resource({
					sources: [
						{
							key: "filtered",
							mode: "list",
							fields: ["name"],
							membership: true,
							filters: {
								fields: ["name", "status"],
								operators: ["contains"],
								combinations: ["any"],
								text: [comparison],
							},
							async run(request) {
								calls.push("filtered");
								await membership.promise;
								return {
									facts: [fact("a", { name: "Alpha" })],
									memberships: [
										{
											resource: "things",
											where: request.where,
											identities: ["a"],
											complete: true,
											basis: ["read"],
										},
									],
								};
							},
						},
						{
							key: "measurement",
							mode: "one",
							fields: ["notes"],
							async run() {
								calls.push("measurement");
								return {
									facts: [
										{
											resource: "things",
											identity: "a",
											values: { notes: "New sample" },
											basis: ["read"],
										},
									],
								};
							},
						},
					],
				}),
			),
			maxConcurrent,
		});
		t.after(() => runtime.close());
		runtime.observe({
			facts: [fact("a", { name: "Alpha", notes: "Previous sample" })],
			memberships: [
				{
					resource: "things",
					identities: ["a"],
					complete: true,
					basis: ["read"],
				},
			],
		});
		const view = runtime.watch(
			query({
				resource: "things",
				mode: "list",
				select: ["name", "notes"],
				where: {
					$or: [
						{ name: { contains: "needle", ...comparison } },
						{ status: { contains: "needle", ...comparison } },
					],
				},
				sample: { fields: ["notes"], intervalMs: 100 },
			}),
		);
		t.after(view.subscribe(() => {}));
		await tick();
		assert.deepEqual(calls, ["filtered"]);
		assert.equal(
			view.getSnapshot().unresolved[0]?.data.notes,
			"Previous sample",
		);
		t.mock.timers.tick(100);
		await tick();
		await tick();
		membership.resolve();
		await tick();
		await tick();
		assert.equal(view.getSnapshot().confirmed.complete, true);
		assert.equal(view.getSnapshot().rows[0]?.data.notes, "New sample");
		assert.equal(view.getSnapshot().settled, true);
		assert.deepEqual(calls, ["filtered", "measurement"]);
	});
}
