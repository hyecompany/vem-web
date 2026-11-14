// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	createRuntime,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";

const authority = query({
	resource: "server",
	mode: "one",
	identity: "current",
	select: ["auth"],
});
const tasks = (fields: readonly string[]) =>
	query({ resource: "tasks", mode: "list", select: fields });
const serverFact = () => ({
	resource: "server",
	identity: "current",
	presence: "present" as const,
	values: { auth: "trusted" },
	basis: ["public"],
});
const definition = (calls: string[]): ResourceDefinition => ({
	name: "tasks",
	readPrerequisites: () => [authority],
	sources: [
		{
			key: "names",
			mode: "list",
			membership: true,
			fields: ["name"],
			cost: 1,
			run: async () => {
				calls.push("names");
				return {
					facts: [
						{
							resource: "tasks",
							identity: "a",
							presence: "present",
							values: { name: "A" },
							basis: ["public"],
						},
					],
					memberships: [
						{
							resource: "tasks",
							identities: ["a"],
							complete: true,
							basis: ["public"],
						},
					],
				};
			},
		},
		{
			key: "full",
			mode: "list",
			membership: true,
			fields: ["name", "notes"],
			cost: 2,
			run: async () => {
				calls.push("full");
				return {
					facts: [
						{
							resource: "tasks",
							identity: "a",
							presence: "present",
							values: { name: "A", notes: "Bring lunch" },
							basis: ["public"],
						},
					],
					memberships: [
						{
							resource: "tasks",
							identities: ["a"],
							complete: true,
							basis: ["public"],
						},
					],
				};
			},
		},
	],
});

test("mandatory prior information is shared before optimizing the remaining consumer stack", async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition(calls),
			{
				name: "server",
				sources: [
					{
						key: "auth",
						mode: "one",
						fields: ["auth"],
						run: async (_request, context) => {
							assert.equal(context.fetchPriority, "high");
							calls.push("auth");
							return { facts: [serverFact()] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const [names, notes] = await Promise.all([
		runtime.read(tasks(["name"])),
		runtime.read(tasks(["notes"])),
	]);
	assert.deepEqual(calls, ["auth", "full"]);
	assert.equal(names.rows[0]?.data.name, "A");
	assert.equal(notes.rows[0]?.data.notes, "Bring lunch");
	runtime.observe({
		invalidate: [{ resource: "server", identity: "current", field: "auth" }],
	});
	await runtime.read(tasks(["name"]));
	assert.deepEqual(calls, ["auth", "full"]);
});

test("failed shared prerequisites settle and simultaneous retries coalesce before continuing", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	let fail = true;
	const runtime = createRuntime({
		resources: [
			definition(calls),
			{
				name: "server",
				sources: [
					{
						key: "auth",
						mode: "one",
						fields: ["auth"],
						run: async () => {
							calls.push("auth");
							if (fail) throw new Error("Offline");
							return { facts: [serverFact()] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const first = runtime.watch(tasks(["name"])),
		second = runtime.watch(tasks(["notes"]));
	t.after(first.subscribe(() => undefined));
	t.after(second.subscribe(() => undefined));
	const failed = await Promise.all([
		runtime.read(tasks(["name"])),
		runtime.read(tasks(["notes"])),
	]);
	assert.deepEqual(calls, ["auth"]);
	assert.ok(
		failed.every(
			(result) =>
				result.settled && result.issues.some((issue) => issue.kind === "read"),
		),
	);
	fail = false;
	const results = await Promise.all([first.retry(), second.retry()]);
	assert.deepEqual(calls, ["auth", "auth", "full"]);
	assert.ok(
		results.every(
			(result) => result.confirmed.complete && result.issues.length === 0,
		),
	);
});

test("a denied prerequisite field cannot masquerade as already satisfied information", async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition(calls),
			{
				name: "server",
				fieldAccess: { auth: "server:auth" },
				sources: [
					{
						key: "auth",
						mode: "one",
						fields: ["auth"],
						run: async () => {
							calls.push("auth");
							return { facts: [serverFact()] };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.setAccess({ decisions: [{ scope: "server:auth", state: "denied" }] });
	const result = await runtime.read(tasks(["name"]));
	assert.deepEqual(calls, []);
	assert.equal(result.settled, true);
	assert.equal(result.issues[0]?.kind, "access");
});

test("cyclic mandatory prerequisites settle without dispatching the guarded source", async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition(calls),
			{
				name: "server",
				readPrerequisites: () => [tasks(["name"])],
				sources: [],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(tasks(["name"]));
	assert.deepEqual(calls, []);
	assert.equal(result.settled, true);
	assert.equal(result.issues[0]?.kind, "unsupported");
});
