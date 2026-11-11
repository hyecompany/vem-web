// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	type AcquisitionSource,
	createRuntime,
	type ObservationBatch,
} from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";

const tasks = [
	{ id: "walk", title: "Plan a walk", status: "open", assignee: "me" },
	{ id: "picnic", title: "Pack a picnic", status: "done", assignee: "me" },
	{ id: "other", title: "Another task", status: "open", assignee: "other" },
];
const filtered = (where: Record<string, string>) =>
	query({ resource: "tasks", mode: "list", select: ["title"], where });
function setup(
	cost: AcquisitionSource["cost"],
	fields: readonly string[] = ["title", "status", "assignee"],
	available?: AcquisitionSource["available"],
) {
	const calls: Array<Readonly<Record<string, unknown>> | undefined> = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: () => "public",
				sources: [
					{
						key: "tasks",
						mode: "list",
						fields,
						filters: ["status", "assignee"],
						membership: true,
						cost,
						available,
						async run(request) {
							calls.push(request.where);
							const matches = tasks.filter((task) =>
								Object.entries(request.where ?? {}).every(
									([key, value]) => task[key as keyof typeof task] === value,
								),
							);
							return {
								facts: matches.map(({ id, ...values }) => ({
									resource: "tasks",
									identity: id,
									values: Object.fromEntries(
										Object.entries(values).filter(([field]) =>
											fields.includes(field),
										),
									),
									presence: "present" as const,
									basis: ["public"],
								})),
								memberships: [
									{
										resource: "tasks",
										where: request.where,
										identities: matches.map((task) => task.id),
										complete: true,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
			},
		],
	});
	return { runtime, calls };
}

test("combined consumers can share a cheaper supported common filter", {
	timeout: 5000,
}, async (t) => {
	const { runtime, calls } = setup((request) =>
		request.where?.status ? 1 : request.where?.assignee ? 1.5 : 5,
	);
	t.after(() => runtime.close());
	const [open, done] = await Promise.all([
		runtime.read(filtered({ status: "open", assignee: "me" })),
		runtime.read(filtered({ status: "done", assignee: "me" })),
	]);
	assert.deepEqual(calls, [{ assignee: "me" }]);
	assert.equal(open.confirmed.complete, true);
	assert.equal(done.confirmed.complete, true);
	assert.deepEqual(
		open.rows.map((row) => row.data.title),
		["Plan a walk"],
	);
	assert.deepEqual(
		done.rows.map((row) => row.data.title),
		["Pack a picnic"],
	);
});

test("supported filters remain selective when broader reads cost more than their combination", {
	timeout: 5000,
}, async (t) => {
	const { runtime, calls } = setup((request) =>
		request.where?.status ? 1 : request.where?.assignee ? 3 : 5,
	);
	t.after(() => runtime.close());
	const results = await Promise.all([
		runtime.read(filtered({ status: "open", assignee: "me" })),
		runtime.read(filtered({ status: "done", assignee: "me" })),
	]);
	assert.equal(calls.length, 2);
	assert.deepEqual(
		new Set(calls.map((where) => where?.status)),
		new Set(["open", "done"]),
	);
	assert.ok(calls.every((where) => where?.assignee === "me"));
	assert.ok(
		results.every((result) => result.confirmed.complete),
		JSON.stringify(results),
	);
});

test("one unfiltered source can satisfy different status consumers when its combined cost is lower", {
	timeout: 5000,
}, async (t) => {
	const { runtime, calls } = setup((request) =>
		request.where?.status ? 1 : 1.5,
	);
	t.after(() => runtime.close());
	const [open, done] = await Promise.all([
		runtime.read(filtered({ status: "open" })),
		runtime.read(filtered({ status: "done" })),
	]);
	assert.deepEqual(calls, [undefined]);
	assert.equal(open.confirmed.complete, true);
	assert.equal(done.confirmed.complete, true);
	assert.equal(open.rows.length, 2);
	assert.equal(done.rows.length, 1);
});

test("filtered replies retain uncertainty about newer records with unknown or matching predicates", {
	timeout: 5000,
}, async (t) => {
	for (const status of [undefined, "open", "done"]) {
		const started = deferred<void>();
		const response = deferred<ObservationBatch>();
		let reads = 0;
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					access: () => "public",
					sources: [
						{
							key: "open-tasks",
							mode: "list",
							fields: ["title", "status"],
							membership: true,
							filters: ["status"],
							available: (request) => request.where?.status === "open",
							run: async () => {
								if (++reads > 1)
									throw new Error("No further evidence is available");
								started.resolve();
								return response.promise;
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		const reading = runtime.read(filtered({ status: "open" }));
		await started.promise;
		runtime.observe({
			facts: [
				{
					resource: "tasks",
					identity: "newer",
					presence: "present",
					values: {
						title: "New task",
						...(status === undefined ? {} : { status }),
					},
					basis: ["public"],
				},
			],
		});
		response.resolve({
			memberships: [
				{
					resource: "tasks",
					where: { status: "open" },
					identities: [],
					complete: true,
					basis: ["public"],
				},
			],
		});
		const result = await reading;
		assert.equal(
			result.confirmed.complete,
			status === "done",
			`Status ${status}`,
		);
		assert.equal(result.empty, status === "done");
	}
});

test("a broader read cannot replace server predicate evidence when no source provides the predicate field", {
	timeout: 5000,
}, async (t) => {
	const { runtime, calls } = setup(
		(request) => (request.where?.status ? 1 : 1.5),
		["title"],
	);
	t.after(() => runtime.close());
	const [open, done] = await Promise.all([
		runtime.read(filtered({ status: "open" })),
		runtime.read(filtered({ status: "done" })),
	]);
	assert.equal(calls.length, 2);
	assert.deepEqual(
		new Set(calls.map((where) => where?.status)),
		new Set(["open", "done"]),
	);
	assert.equal(open.confirmed.complete, true);
	assert.equal(done.confirmed.complete, true);
	assert.equal(open.rows.length, 2);
	assert.equal(done.rows.length, 1);
	assert.equal(open.unresolved.length, 0);
	assert.equal(done.unresolved.length, 0);
});

test("declared equality filters establish their values from actual matching membership", {
	timeout: 5000,
}, async (t) => {
	const { runtime, calls } = setup(
		1,
		["title"],
		(request) => request.where?.status !== undefined,
	);
	t.after(() => runtime.close());
	const results = await Promise.all(
		["open", "done"].map((status) =>
			runtime.read(
				query<{ title: string; status: string }>({
					...filtered({ status }),
					__values: undefined,
					select: ["title", "status"],
				}),
			),
		),
	);
	assert.equal(calls.length, 2, JSON.stringify({ calls, results }));
	assert.ok(calls.every((where) => where?.status));
	for (const result of results) {
		assert.equal(result.confirmed.complete, true, JSON.stringify(result));
		assert.equal(result.unresolved.length, 0);
		assert.ok(result.rows.length > 0);
		assert.ok(
			result.rows.every(
				(row) =>
					row.complete &&
					(row.data.status === "open" || row.data.status === "done"),
			),
		);
	}
});

test("membership evidence cannot expose a filter whose native field permission is denied", (t) => {
	const runtime = createRuntime({
		access: [{ scope: "status:read", state: "denied" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { status: "status:read" },
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			{
				resource: "tasks",
				identity: "walk",
				presence: "present",
				values: { title: "Walk" },
				basis: ["public"],
			},
		],
		memberships: [
			{
				resource: "tasks",
				where: { status: "open" },
				identities: ["walk"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	const view = runtime.watch(filtered({ status: "open" }));
	t.after(() => view.dispose());
	const result = view.getSnapshot();
	assert.equal(result.rows.length, 0);
	assert.equal(result.unresolved.length, 1);
	assert.equal(result.confirmed.complete, false);
	assert.equal(result.confirmed.total, undefined);
	assert.ok(result.issues.some((issue) => issue.kind === "access"));
});

test("denied sort input does not order public rows and explains the unavailable ordering", (t) => {
	const runtime = createRuntime({
		access: [{ scope: "status:read", state: "denied" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { status: "status:read" },
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [
			{
				resource: "tasks",
				identity: "a",
				presence: "present",
				values: { title: "A", status: "z" },
				basis: ["public"],
			},
			{
				resource: "tasks",
				identity: "b",
				presence: "present",
				values: { title: "B", status: "a" },
				basis: ["public"],
			},
		],
		memberships: [
			{
				resource: "tasks",
				identities: ["a", "b"],
				complete: true,
				basis: ["public"],
			},
		],
	});
	const view = runtime.watch(
		query({
			resource: "tasks",
			mode: "list",
			select: ["title"],
			orderBy: [{ field: "status" }],
		}),
	);
	t.after(() => view.dispose());
	const result = view.getSnapshot();
	assert.deepEqual(
		result.rows.map((row) => row.data.title),
		["A", "B"],
	);
	assert.ok(result.issues.some((issue) => issue.kind === "access"));
});

test("a missing detail still evaluates identity-specific access using its requested identity", (t) => {
	const seen: unknown[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				fieldAccess: {
					title: (identity) => {
						assert.notEqual(identity, undefined);
						seen.push(identity);
						return `task:${(identity as { id: string }).id}:view`;
					},
				},
			},
		],
	});
	t.after(() => runtime.close());
	const view = runtime.watch(
		query({
			resource: "tasks",
			mode: "one",
			identity: { id: "walk" },
			select: ["title"],
		}),
	);
	t.after(() => view.dispose());
	assert.equal(view.getSnapshot().exists, undefined);
	assert.ok(
		seen.some((identity) => (identity as { id: string }).id === "walk"),
	);
});
