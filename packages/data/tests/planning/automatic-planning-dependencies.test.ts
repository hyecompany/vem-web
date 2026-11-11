// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	createRuntime,
	type ObservationBatch,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";

const read = (resource: string, identity: unknown, select: readonly string[]) =>
	query({ resource, identity, select, mode: "one" });
const fact = (
	resource: string,
	identity: unknown,
	values: Record<string, unknown>,
) => ({
	resource,
	identity,
	values,
	presence: "present" as const,
	basis: ["public"],
});

const instanceDefinition = (calls: string[]): ResourceDefinition => ({
	name: "instances",
	access: () => "public",
	sources: [
		{
			key: "instance",
			mode: "one",
			fields: ["profiles"],
			run: async () => {
				calls.push("instance");
				return { facts: [fact("instances", "a", { profiles: ["base"] })] };
			},
		},
	],
	fieldDependencies: {
		expanded: (identity, context) => [
			read("instances", identity, ["profiles"]),
			...(
				(context.get("instances", identity)?.values.profiles as
					| string[]
					| undefined) ?? []
			).map((name) => read("profiles", name, ["config"])),
		],
	},
	derive: (_changed, context) => {
		const names = context.get("instances", "a")?.values.profiles as
			| string[]
			| undefined;
		if (!names) return;
		const profiles = names.map((name) => context.get("profiles", name));
		if (profiles.some((profile) => profile?.values.config === undefined))
			return;
		return {
			facts: [
				{
					...fact("instances", "a", {
						expanded: Object.assign(
							{},
							...profiles.map((profile) => profile?.values.config),
						),
					}),
					dependsOn: [
						{ resource: "instances", identity: "a", field: "profiles" },
						...names.map((name) => ({
							resource: "profiles",
							identity: name,
							field: "config",
						})),
					],
				},
			],
		};
	},
});

test("derived fields acquire discovered cross-resource prerequisites without endpoint orchestration", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			instanceDefinition(calls),
			{
				name: "profiles",
				access: () => "public",
				sources: [
					{
						key: "profile",
						mode: "one",
						fields: ["config"],
						run: async (request) => {
							calls.push(`profile:${String(request.identity)}`);
							return {
								facts: [
									fact("profiles", request.identity, {
										config: { memory: "2GiB" },
									}),
								],
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(read("instances", "a", ["expanded"]));
	assert.deepEqual(calls, ["instance", "profile:base"]);
	assert.equal(result.rows[0]?.complete, true);
	assert.deepEqual(result.rows[0]?.data.expanded, { memory: "2GiB" });
	assert.equal(result.rows[0]?.fields.expanded?.source, "derived");
	await runtime.read(read("profiles", "base", ["config"]));
	assert.equal(calls.length, 2);
});

test("denied prerequisites cannot be acquired through an otherwise permitted derived query", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		access: [{ scope: "profiles:read", state: "denied" }],
		resources: [
			instanceDefinition(calls),
			{
				name: "profiles",
				access: () => "profiles:read",
				sources: [
					{
						key: "profile",
						mode: "one",
						fields: ["config"],
						run: async () => {
							throw new Error("A denied prerequisite was dispatched");
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(read("instances", "a", ["expanded"]));
	assert.equal(result.settled, true);
	assert.equal(result.rows[0]?.complete, false);
	assert.deepEqual(calls, ["instance"]);
});

test("cyclic derived-field prerequisites settle as unobtainable information", {
	timeout: 5000,
}, async (t) => {
	const runtime = createRuntime({
		resources: [
			{
				name: "items",
				access: () => "public",
				sources: [],
				fieldDependencies: {
					a: (identity) => [read("items", identity, ["b"])],
					b: (identity) => [read("items", identity, ["a"])],
				},
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(read("items", "x", ["a"]));
	assert.equal(result.settled, true);
	assert.equal(result.confirmed.complete, false);
	assert.equal(
		result.issues.some((issue) => issue.kind === "unsupported"),
		true,
	);
});

test("field-level denial preserves acquisition of independently permitted fields", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		access: [{ scope: "notes:read", state: "denied" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { notes: "notes:read" },
				sources: [
					{
						key: "title",
						mode: "one",
						fields: ["title"],
						run: async () => {
							calls.push("title");
							return { facts: [fact("tasks", "a", { title: "Walk" })] };
						},
					},
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							calls.push("notes");
							return { facts: [fact("tasks", "a", { notes: "Secret" })] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(read("tasks", "a", ["title", "notes"]));
	assert.equal(result.settled, true);
	assert.equal(result.rows[0]?.data.title, "Walk");
	assert.equal(result.rows[0]?.data.notes, undefined);
	assert.equal(result.rows[0]?.complete, false);
	assert.equal(
		result.issues.some((issue) => issue.kind === "access"),
		true,
	);
	assert.deepEqual(calls, ["title"]);
});

test("native conjunction disclosure forgets protected facts while independent public fields survive", (t) => {
	const runtime = createRuntime({
		access: [
			{ scope: "signed-in", state: "allowed" },
			{ scope: "notes:read", state: "allowed" },
		],
		resources: [
			{
				name: "tasks",
				fieldAccess: { notes: { all: ["signed-in", "notes:read"] } },
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe({
		facts: [fact("tasks", "a", { title: "Walk", notes: "Protected" })],
	});
	const handle = runtime.watch(read("tasks", "a", ["title", "notes"]));
	assert.equal(handle.getSnapshot().rows[0]?.complete, true);
	runtime.revoke("notes:read");
	assert.equal(handle.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(handle.getSnapshot().rows[0]?.data.notes, undefined);
	assert.equal(
		runtime.readModelSnapshot().records[0]?.confirmed?.values.notes,
		undefined,
	);
	runtime.setAccess({ decisions: [{ scope: "notes:read", state: "allowed" }] });
	assert.equal(handle.getSnapshot().rows[0]?.data.notes, undefined);
});

test("native field grants awaken the remaining permitted acquisition", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		access: [{ scope: "notes:read", state: "denied" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { notes: "notes:read" },
				sources: [
					{
						key: "title",
						mode: "one",
						fields: ["title"],
						run: async () => {
							calls.push("title");
							return { facts: [fact("tasks", "a", { title: "Walk" })] };
						},
					},
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						run: async () => {
							calls.push("notes");
							return { facts: [fact("tasks", "a", { notes: "New grant" })] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = read("tasks", "a", ["title", "notes"]);
	assert.equal((await runtime.read(descriptor)).rows[0]?.complete, false);
	runtime.setAccess({ decisions: [{ scope: "notes:read", state: "allowed" }] });
	const result = await runtime.read(descriptor);
	assert.equal(result.rows[0]?.complete, true);
	assert.equal(result.rows[0]?.data.notes, "New grant");
	assert.deepEqual(calls, ["title", "notes"]);
});

test("native field proof retirement fences late responses and does not prevent current acquisition", {
	timeout: 5000,
}, async (t) => {
	const old = deferred<ObservationBatch>();
	let calls = 0;
	const runtime = createRuntime({
		access: [{ scope: "notes:read", state: "allowed" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { notes: "notes:read" },
				sources: [
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						run: async () =>
							++calls === 1
								? old.promise
								: { facts: [fact("tasks", "a", { notes: "Current grant" })] },
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = read("tasks", "a", ["notes"]);
	const handle = runtime.watch(descriptor);
	const seen: unknown[] = [];
	t.after(
		handle.subscribe(() => seen.push(handle.getSnapshot().rows[0]?.data.notes)),
	);
	for (let i = 0; i < 100 && calls === 0; i++)
		await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
	runtime.revoke("notes:read");
	runtime.setAccess({ decisions: [{ scope: "notes:read", state: "allowed" }] });
	old.resolve({ facts: [fact("tasks", "a", { notes: "Retired grant" })] });
	const result = await runtime.read(descriptor);
	assert.equal(seen.includes("Retired grant"), false);
	assert.equal(result.rows[0]?.data.notes, "Current grant");
	assert.equal(calls, 2);
});

test("relationship prerequisites respect the related resource's read authority", {
	timeout: 5000,
}, async (t) => {
	let relationshipReads = 0;
	const runtime = createRuntime({
		access: [{ scope: "profiles:read", state: "denied" }],
		resources: [
			{
				name: "instances",
				sources: [],
				fieldDependencies: {
					expanded: () => [
						{ resource: "profiles", identity: "base", relationship: "parent" },
					],
				},
			},
			{
				name: "profiles",
				access: () => "profiles:read",
				sources: [
					{
						key: "parents",
						mode: "one",
						fields: [],
						relationships: ["parent"],
						run: async () => {
							relationshipReads++;
							return {
								relationships: [
									{
										resource: "profiles",
										identity: "base",
										relationship: "parent",
										targets: [],
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
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("instances", "a", {})] });
	const result = await runtime.read(read("instances", "a", ["expanded"]));
	assert.equal(result.settled, true);
	assert.equal(relationshipReads, 0);
});

test("identity-based field rules receive discovered resources rather than a fabricated collection identity", {
	timeout: 5000,
}, async (t) => {
	const identity = { project: "one", id: "a" };
	const runtime = createRuntime({
		access: [{ scope: "project:one", state: "allowed" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: {
					title: (target) => {
						assert.ok(target && typeof target === "object");
						return `project:${(target as { project: string }).project}`;
					},
				},
				sources: [
					{
						key: "list",
						mode: "list",
						fields: ["title"],
						membership: true,
						access: "project:one",
						run: async () => ({
							facts: [fact("tasks", identity, { title: "Walk" })],
							memberships: [
								{
									resource: "tasks",
									identities: [identity],
									complete: true,
									basis: ["public"],
								},
							],
						}),
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(
		query({ resource: "tasks", mode: "list", select: ["title"] }),
	);
	assert.equal(result.confirmed.complete, true);
	assert.equal(result.rows[0]?.data.title, "Walk");
});
