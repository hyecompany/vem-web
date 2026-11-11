// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import type {
	ObservationBatch,
	QueryDescriptor,
	ResourceDefinition,
} from "../../src/types.js";

const continuity = { channel: "test-events" };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const options = (extra: Partial<ResourceDefinition> = {}) => ({
	contextId: "alice",
	access: [{ scope: "read", state: "allowed" as const }],
	resources: [{ name: "things", access: () => "read", ...extra }],
});
const fact = (identity: string, status: string) => ({
	liveness: continuity,
	resource: "things",
	identity,
	presence: "present" as const,
	values: { name: identity, status },
	basis: ["read"],
});
const list: QueryDescriptor = query({
	resource: "things",
	mode: "list",
	select: ["name"],
});

test("restored absence must be checked before proving a detail is empty", async () => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({
		...options({ persist: () => true }),
		persistence,
	});
	await first.ready;
	first.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				presence: "absent",
				basis: ["read"],
			},
		],
	});
	await first.flush();
	first.close();
	let reads = 0;
	const second = createRuntime({
		...options({
			sources: [
				{
					key: "detail",
					mode: "one",
					fields: ["name", "status"],
					run: async () => {
						reads++;
						return { facts: [fact("a", "Running")] };
					},
				},
			],
		}),
		persistence,
	});
	await second.ready;
	const descriptor = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["name"],
	});
	const initial = second.watch(descriptor).getSnapshot();
	assert.equal(initial.empty, false);
	assert.equal(initial.exists, undefined);
	const result = await second.read(descriptor);
	assert.equal(reads, 1);
	assert.equal(result.rows[0]?.data.name, "a");
	assert.equal(result.exists, true);
	second.close();
});

test("a stale unselected predicate cannot prove a match or an empty filtered result", async () => {
	for (const initial of ["Running", "Stopped"]) {
		let reads = 0;
		const response = deferred<ObservationBatch>();
		const runtime = createRuntime(
			options({
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "status"],
						membership: true,
						run: async () => {
							reads++;
							return response.promise;
						},
					},
				],
			}),
		);
		runtime.observe({
			facts: [fact("a", initial)],
			memberships: [
				{
					liveness: continuity,
					resource: "things",
					identities: ["a"],
					complete: true,
					basis: ["read"],
				},
			],
		});
		const handle = runtime.watch({ ...list, where: { status: "Running" } });
		handle.subscribe(() => undefined);
		await tick();
		assert.equal(reads, 0);
		runtime.observe({
			invalidate: [{ resource: "things", identity: "a", field: "status" }],
		});
		assert.equal(handle.getSnapshot().rows.length, 0);
		assert.equal(handle.getSnapshot().unresolved.length, 1);
		assert.equal(handle.getSnapshot().empty, false);
		await tick();
		assert.equal(reads, 1);
		response.resolve({ facts: [fact("a", "Running")] });
		await tick();
		assert.equal(handle.getSnapshot().rows.length, 1);
		runtime.close();
	}
});

test("a scoped gap withdraws empty broader and narrower memberships", async () => {
	const scopes = [
		{ project: "team" },
		{ allProjects: true },
		{ project: "team", target: "node-a" },
	];
	const reads: unknown[] = [];
	const runtime = createRuntime(
		options({
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status"],
					membership: true,
					run: async (descriptor) => {
						reads.push(descriptor.scope);
						return {
							memberships: [
								{
									liveness: continuity,
									resource: "things",
									scope: descriptor.scope,
									identities: [],
									complete: true,
									basis: ["read"],
								},
							],
						};
					},
				},
			],
		}),
	);
	const handles = scopes.map((scope) => runtime.watch({ ...list, scope }));
	for (const handle of handles) handle.subscribe(() => undefined);
	await tick();
	assert.equal(
		handles.every((handle) => handle.getSnapshot().empty),
		true,
	);
	reads.length = 0;
	runtime.setContinuity(continuity, "interrupted");
	assert.equal(
		handles.every((handle) => !handle.getSnapshot().empty),
		true,
	);
	await tick();
	assert.equal(reads.length, 3);
	assert.equal(
		handles.every((handle) => handle.getSnapshot().empty),
		true,
	);
	runtime.close();
});

test("an empty response dispatched before a gap cannot repair coverage", async () => {
	const responses = [
		deferred<ObservationBatch>(),
		deferred<ObservationBatch>(),
	];
	let reads = 0;
	const runtime = createRuntime(
		options({
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status"],
					membership: true,
					run: async () => responses[reads++]?.promise,
				},
			],
		}),
	);
	const handle = runtime.watch(list);
	const complete: boolean[] = [];
	handle.subscribe(() =>
		complete.push(handle.getSnapshot().confirmed.complete),
	);
	await tick();
	runtime.setContinuity(continuity, "interrupted");
	responses[0]?.resolve({
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: [],
				complete: true,
				basis: ["read"],
			},
		],
	});
	await tick();
	assert.equal(reads, 2);
	assert.equal(complete.includes(true), false);
	responses[1]?.resolve({
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: [],
				complete: true,
				basis: ["read"],
			},
		],
	});
	await tick();
	assert.equal(handle.getSnapshot().empty, true);
	runtime.close();
});

test("a gap before the first detail arrives fences that response and acquires current evidence", async () => {
	const responses = [
		deferred<ObservationBatch>(),
		deferred<ObservationBatch>(),
	];
	let reads = 0;
	const runtime = createRuntime(
		options({
			sources: [
				{
					key: "detail",
					mode: "one",
					fields: ["name", "status"],
					run: async () => {
						const response = responses[reads++];
						assert.ok(response);
						return response.promise;
					},
				},
			],
		}),
	);
	const handle = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "a",
			select: ["name", "status"],
		}),
	);
	handle.subscribe(() => undefined);
	await tick();
	runtime.setContinuity(continuity, "interrupted");
	responses[0]?.resolve({ facts: [fact("a", "Stopped")] });
	await tick();
	assert.equal(reads, 2);
	assert.equal(handle.getSnapshot().rows[0]?.data.status, "Stopped");
	assert.equal(handle.getSnapshot().rows[0]?.fields.status?.stale, true);
	assert.equal(handle.getSnapshot().rows[0]?.complete, true);
	assert.equal(handle.getSnapshot().confirmed.complete, false);
	responses[1]?.resolve({ facts: [fact("a", "Running")] });
	await tick();
	assert.equal(handle.getSnapshot().rows[0]?.data.status, "Running");
	runtime.close();
});

test("concurrent overlapping lists and newer detail fields preserve valid membership", async () => {
	const scopes = ["project", "member", "all"];
	const responses = scopes.map(() => deferred<ObservationBatch>());
	const runtime = createRuntime(
		options({
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status"],
					membership: true,
					run: async (descriptor) =>
						responses[scopes.indexOf(descriptor.scope as string)]?.promise,
				},
			],
		}),
	);
	const handles = scopes.map((scope) => runtime.watch({ ...list, scope }));
	for (const handle of handles) handle.subscribe(() => undefined);
	await tick();
	for (const [index, scope] of scopes.entries()) {
		responses[index]?.resolve({
			facts: [fact("a", "Running")],
			memberships: [
				{
					liveness: continuity,
					resource: "things",
					scope,
					identities: ["a"],
					complete: true,
					basis: ["read"],
				},
			],
		});
		await tick();
	}
	assert.equal(
		handles.every((handle) => handle.getSnapshot().confirmed.complete),
		true,
	);
	runtime.close();
});

test("an old collection response cannot resurrect a later deletion through membership", async () => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime(
		options({
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status"],
					membership: true,
					run: async () => response.promise,
				},
			],
		}),
	);
	const result = runtime.read(list);
	await tick();
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				presence: "absent",
				basis: ["read"],
			},
		],
	});
	response.resolve({
		facts: [fact("a", "Running")],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	assert.equal((await result).rows.length, 0);
	runtime.close();
});

test("sorting can use a field without exposing it in selected data", async () => {
	const runtime = createRuntime(options());
	runtime.observe({
		facts: [fact("a", "2"), fact("b", "1")],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: ["a", "b"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const result = await runtime.read({
		...list,
		orderBy: [{ field: "status" }],
	});
	assert.deepEqual(
		result.rows.map((row) => row.data.name),
		["b", "a"],
	);
	assert.deepEqual(Object.keys(result.rows[0]?.data ?? {}), ["name"]);
	runtime.close();
});

test("replacement clears only omitted representation fields and fences newer observations", async () => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime(
		options({
			sources: [
				{
					key: "detail",
					mode: "one",
					fields: ["name", "description", "state"],
					run: async () => response.promise,
				},
			],
		}),
	);
	runtime.observe({
		facts: [
			{
				...fact("a", "Running"),
				values: { name: "a", description: "old", state: { pid: 42 } },
			},
		],
	});
	const descriptor = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["name", "description", "state"],
	});
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { name: "a" },
				replace: ["name", "description"],
				basis: ["read"],
			},
		],
	});
	const before = runtime.watch(descriptor).getSnapshot().rows[0];
	assert.ok(before);
	assert.deepEqual(before.missing, ["description"]);
	assert.deepEqual(before.data.state, { pid: 42 });
	const read = runtime.read(descriptor);
	await tick();
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { description: "new" },
				basis: ["read"],
			},
		],
	});
	response.resolve({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { name: "a" },
				replace: ["name", "description"],
				basis: ["read"],
			},
		],
	});
	assert.equal((await read).rows[0]?.data.description, "new");
	runtime.close();
});

test("an empty scoped collection excludes rows without asserting global deletion", () => {
	const runtime = createRuntime(options());
	runtime.observe({
		facts: [fact("a", "Running")],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				scope: "node-a",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const scoped = runtime.watch({ ...list, scope: "node-a" });
	const detail = runtime.watch(
		query({ resource: "things", mode: "one", identity: "a", select: ["name"] }),
	);
	runtime.observe({
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				scope: "node-a",
				identities: [],
				complete: true,
				basis: ["read"],
			},
		],
	});
	assert.equal(scoped.getSnapshot().empty, true);
	assert.equal(detail.getSnapshot().exists, true);
	assert.equal(detail.getSnapshot().rows[0]?.data.name, "a");
	runtime.close();
});

test("current persistence policy rejects and removes formerly persisted payloads", async () => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({
		...options({ persist: () => true }),
		persistence,
	});
	await first.ready;
	first.observe({
		facts: [
			{
				...fact("a", "Running"),
				values: { name: "a", config: { password: "secret-value" } },
			},
		],
	});
	await first.flush();
	first.close();
	const second = createRuntime({
		...options({
			persist: (field) => field === "name" || field === "$presence",
		}),
		persistence,
	});
	await second.ready;
	await second.flush();
	const value = second
		.watch(
			query({
				resource: "things",
				mode: "one",
				identity: "a",
				select: ["name", "config"],
			}),
		)
		.getSnapshot().rows[0];
	assert.ok(value);
	assert.deepEqual(value.data, { name: "a" });
	assert.deepEqual(value.missing, ["config"]);
	assert.equal(
		JSON.stringify([...persistence.facts.values()]).includes("secret-value"),
		false,
	);
	second.close();
});

test("display freshness preserves rows while scope freshness only affects possible members", () => {
	const runtime = createRuntime(
		options({
			queryDependencies: (descriptor) =>
				(descriptor.scope as { target?: string } | undefined)?.target
					? ["location"]
					: [],
			inScope: (identity, scope, values) => {
				if (
					(identity as string).startsWith(
						`${(scope as { project: string }).project}/`,
					) === false
				)
					return false;
				const target = (scope as { target?: string }).target;
				if (!target) return true;
				return values.location === undefined
					? "unknown"
					: values.location === target;
			},
		}),
	);
	runtime.observe({
		facts: [
			{
				...fact("team/a", "Running"),
				values: { name: "a", location: "node-a", status: "Running" },
			},
			{
				...fact("other/b", "Running"),
				values: { name: "b", location: "node-a", status: "Running" },
			},
		],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				scope: { project: "team" },
				identities: ["team/a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const project = runtime.watch({
		...list,
		select: ["name", "status"],
		scope: { project: "team" },
	});
	const member = runtime.watch({
		...list,
		scope: { project: "team", target: "node-a" },
	});
	runtime.observe({
		invalidate: [
			{ resource: "things", identity: "team/a", field: "status" },
			{ resource: "things", identity: "other/b", field: "location" },
		],
	});
	assert.equal(project.getSnapshot().rows.length, 1);
	assert.equal(project.getSnapshot().unresolved.length, 0);
	assert.equal(project.getSnapshot().confirmed.complete, true);
	assert.equal(member.getSnapshot().rows.length, 1);
	assert.equal(member.getSnapshot().unresolved.length, 0);
	runtime.observe({
		invalidate: [{ resource: "things", identity: "team/a", field: "location" }],
	});
	assert.equal(member.getSnapshot().rows.length, 0);
	assert.equal(member.getSnapshot().unresolved.length, 1);
	runtime.close();
});

test("a custom predicate does not make an unfiltered row depend on display freshness", () => {
	const runtime = createRuntime(options({ matches: () => true }));
	runtime.observe({
		facts: [fact("a", "Running")],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const handle = runtime.watch({ ...list, select: ["name", "status"] });
	runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "status" }],
	});
	assert.equal(handle.getSnapshot().rows.length, 1);
	assert.equal(handle.getSnapshot().unresolved.length, 0);
	assert.equal(handle.getSnapshot().rows[0]?.fields.status?.stale, true);
	runtime.close();
});

test("current membership establishes a scoped match without a missing scope field", () => {
	const runtime = createRuntime(
		options({
			queryDependencies: () => ["location"],
			inScope: (_identity, scope, values) =>
				values.location === undefined ? "unknown" : values.location === scope,
		}),
	);
	const descriptor = { ...list, scope: "node-a", select: ["name", "location"] };
	const handle = runtime.watch(descriptor);
	runtime.observe({
		facts: [fact("a", "Running")],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				scope: "node-a",
				identities: ["a"],
				complete: false,
				basis: ["read"],
			},
		],
	});
	assert.equal(handle.getSnapshot().rows.length, 1);
	assert.deepEqual(handle.getSnapshot().rows[0]?.missing, ["location"]);
	assert.equal(handle.getSnapshot().unresolved.length, 0);
	runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "location" }],
	});
	assert.equal(handle.getSnapshot().rows.length, 0);
	assert.equal(handle.getSnapshot().unresolved.length, 1);
	runtime.observe({
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				scope: "node-a",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	assert.equal(handle.getSnapshot().rows.length, 1);
	assert.equal(handle.getSnapshot().confirmed.complete, true);
	runtime.setContinuity(continuity, "interrupted");
	assert.equal(handle.getSnapshot().rows.length, 0);
	assert.equal(handle.getSnapshot().unresolved.length, 1);
	runtime.close();
});

test("scope membership and independent predicate fields compose without redundant acquisition", async () => {
	let reads = 0;
	const runtime = createRuntime(
		options({
			queryDependencies: (descriptor) => [
				"location",
				...Object.keys(descriptor.where ?? {}),
			],
			inScope: (_identity, scope, values) =>
				values.location === undefined ? "unknown" : values.location === scope,
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status", "location"],
					membership: true,
					run: async () => {
						reads++;
					},
				},
			],
		}),
	);
	const membership = {
		liveness: continuity,
		resource: "things",
		scope: "node-a",
		identities: ["a", "b"],
		complete: true,
		basis: ["read"],
	};
	runtime.observe({ memberships: [membership] });
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { name: "a", status: "Running" },
				basis: ["read"],
			},
			{
				liveness: continuity,
				resource: "things",
				identity: "b",
				values: { name: "b", status: "Stopped" },
				basis: ["read"],
			},
		],
	});
	const descriptor = { ...list, scope: "node-a", where: { status: "Running" } };
	const result = await runtime.read(descriptor);
	assert.deepEqual(
		result.rows.map((row) => row.data.name),
		["a"],
	);
	assert.equal(result.confirmed.complete, true);
	assert.equal(reads, 0);
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { status: "Stopped" },
				basis: ["read"],
			},
		],
	});
	assert.equal((await runtime.read(descriptor)).empty, true);
	assert.equal(reads, 0);
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { status: "Running" },
				basis: ["read"],
			},
		],
	});
	runtime.observe({
		invalidate: [{ resource: "things", identity: "a", field: "location" }],
	});
	assert.equal((await runtime.read(descriptor)).unresolved.length, 1);
	assert.equal(reads, 1);
	runtime.observe({ memberships: [membership] });
	assert.equal((await runtime.read(descriptor)).rows[0]?.data.name, "a");
	assert.equal(reads, 1);
	runtime.setContinuity(continuity, "interrupted");
	assert.equal((await runtime.read(descriptor)).confirmed.complete, false);
	assert.equal(reads, 2);
	runtime.close();
});
