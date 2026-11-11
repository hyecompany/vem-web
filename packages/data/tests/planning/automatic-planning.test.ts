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

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100 && !predicate(); i++) await tick();
	assert.ok(predicate(), "Expected acquisition progress");
}
const fact = (identity: unknown, values: Record<string, unknown> = {}) => ({
	resource: "tasks",
	identity,
	presence: "present" as const,
	values,
	basis: ["public"],
});
const collection = (
	identities: readonly unknown[],
	scope?: unknown,
	complete = true,
) => ({ resource: "tasks", identities, scope, complete, basis: ["public"] });
const one = (identity: unknown, select: readonly string[]) =>
	query({ resource: "tasks", mode: "one", identity, select });
const list = (select: readonly string[], scope?: unknown) =>
	query({ resource: "tasks", mode: "list", scope, select });
const definition = (
	sources: ResourceDefinition["sources"],
	extra: Partial<ResourceDefinition> = {},
): ResourceDefinition => ({
	name: "tasks",
	access: () => "public",
	sources,
	...extra,
});

test("automatic planning chooses shared collection coverage over overlapping point reads", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "overview",
					mode: "list",
					fields: ["title"],
					membership: true,
					cost: 1,
					run: async () => {
						calls.push("overview");
						return {
							facts: [fact("a", { title: "A" })],
							memberships: [collection(["a"])],
						};
					},
				},
				{
					key: "detail",
					mode: "one",
					fields: ["title", "notes"],
					cost: 1,
					run: async (request) => {
						calls.push("detail");
						return {
							facts: [
								fact(request.identity, { title: "A", notes: "Bring lunch" }),
							],
						};
					},
				},
				{
					key: "expanded",
					mode: "list",
					fields: ["title", "notes"],
					membership: true,
					cost: 1.5,
					run: async () => {
						calls.push("expanded");
						return {
							facts: [fact("a", { title: "A", notes: "Bring lunch" })],
							memberships: [collection(["a"])],
						};
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const [overview, detail] = await Promise.all([
		runtime.read(list(["title"])),
		runtime.read(one("a", ["notes"])),
	]);
	assert.deepEqual(calls, ["expanded"]);
	assert.equal(overview.confirmed.complete, true);
	assert.equal(detail.rows[0]?.data.notes, "Bring lunch");
});

test("a lone detail uses the cheaper point source and cached fields require no acquisition", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "detail",
					mode: "one",
					fields: ["title", "notes"],
					cost: 1,
					run: async (request) => {
						calls.push(String(request.identity));
						return {
							facts: [
								fact(request.identity, { title: "A", notes: "Pack water" }),
							],
						};
					},
				},
				{
					key: "collection",
					mode: "list",
					fields: ["title", "notes"],
					membership: true,
					cost: 5,
					run: async () => {
						throw new Error("An expensive collection was unnecessary");
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	runtime.observe({ facts: [fact("a", { title: "A" })] });
	assert.equal(
		(await runtime.read(one("a", ["title"]))).rows[0]?.complete,
		true,
	);
	assert.deepEqual(calls, []);
	assert.equal(
		(await runtime.read(one("a", ["title", "notes"]))).rows[0]?.complete,
		true,
	);
	assert.equal(
		(await runtime.read(one("a", ["notes"]))).rows[0]?.data.notes,
		"Pack water",
	);
	assert.deepEqual(calls, ["a"]);
});

test("separate sources satisfy display fields and filter dependencies without establishing unresolved matches early", {
	timeout: 5000,
}, async (t) => {
	const status = deferred<ObservationBatch>();
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "titles",
					mode: "list",
					fields: ["title"],
					membership: true,
					run: async () => {
						calls.push("titles");
						return {
							facts: [fact("a", { title: "A" }), fact("b", { title: "B" })],
							memberships: [collection(["a", "b"])],
						};
					},
				},
				{
					key: "status",
					mode: "list",
					fields: ["status"],
					run: async () => {
						calls.push("status");
						return status.promise;
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const descriptor = query({
		resource: "tasks",
		mode: "list",
		select: ["title"],
		where: { status: "open" },
	});
	const handle = runtime.watch(descriptor);
	t.after(handle.subscribe(() => undefined));
	await until(
		() =>
			calls.includes("status") && handle.getSnapshot().unresolved.length === 2,
	);
	assert.equal(handle.getSnapshot().rows.length, 0);
	assert.equal(handle.getSnapshot().confirmed.knownCount, 0);
	status.resolve({
		facts: [fact("a", { status: "open" }), fact("b", { status: "done" })],
	});
	const result = await runtime.read(descriptor);
	assert.equal(result.confirmed.complete, true);
	assert.equal(result.confirmed.knownCount, 1);
	assert.equal(result.rows[0]?.data.title, "A");
	assert.deepEqual(calls.sort(), ["status", "titles"]);
	assert.equal((await runtime.read(list(["title"]))).rows.length, 2);
	assert.equal(calls.length, 2);
});

test("membership-only acquisition discovers identities before selecting per-resource detail sources", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "identities",
					mode: "list",
					fields: [],
					membership: true,
					run: async () => {
						calls.push("identities");
						return {
							facts: [fact("a"), fact("b")],
							memberships: [collection(["a", "b"])],
						};
					},
				},
				{
					key: "detail",
					mode: "one",
					fields: ["title"],
					run: async (request) => {
						calls.push(String(request.identity));
						return {
							facts: [fact(request.identity, { title: request.identity })],
						};
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(list(["title"]));
	assert.equal(result.settled, true);
	assert.equal(result.confirmed.complete, true);
	assert.deepEqual(result.rows.map((row) => row.data.title).sort(), ["a", "b"]);
	assert.equal(
		result.rows.every((row) => row.complete),
		true,
	);
	assert.equal(calls[0], "identities");
	assert.deepEqual(calls.slice(1).sort(), ["a", "b"]);
});

test("later consumers join relevant in-flight acquisition instead of duplicating it", {
	timeout: 5000,
}, async (t) => {
	const response = deferred<ObservationBatch>();
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "collection",
					mode: "list",
					fields: ["title", "notes"],
					membership: true,
					run: async () => {
						calls.push("collection");
						return response.promise;
					},
				},
				{
					key: "detail",
					mode: "one",
					fields: ["title", "notes"],
					run: async () => {
						calls.push("detail");
						return { facts: [fact("a", { title: "A", notes: "Notes" })] };
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(list(["title"]));
	void first.catch(() => undefined);
	await until(() => calls.length === 1);
	const second = runtime.read(one("a", ["notes"]));
	void second.catch(() => undefined);
	await tick();
	assert.deepEqual(calls, ["collection"]);
	response.resolve({
		facts: [fact("a", { title: "A", notes: "Notes" })],
		memberships: [collection(["a"])],
	});
	const results = await Promise.all([first, second]);
	assert.equal(
		results.every((result) => result.settled && result.rows[0]?.complete),
		true,
	);
	assert.deepEqual(calls, ["collection"]);
});

test("collection source scope remains isolated when consumers request different projects", {
	timeout: 5000,
}, async (t) => {
	const calls: unknown[] = [];
	const runtime = createRuntime({
		resources: [
			definition(
				[
					{
						key: "project-tasks",
						mode: "list",
						fields: ["title"],
						membership: true,
						run: async (request) => {
							calls.push(request.scope);
							const identity = { project: request.scope, id: "a" };
							return {
								facts: [fact(identity, { title: request.scope })],
								memberships: [collection([identity], request.scope)],
							};
						},
					},
				],
				{
					inScope: (identity, scope) =>
						(identity as { project: unknown }).project === scope,
				},
			),
		],
	});
	t.after(() => runtime.close());
	const [first, second] = await Promise.all([
		runtime.read(list(["title"], "one")),
		runtime.read(list(["title"], "two")),
	]);
	assert.deepEqual(calls.sort(), ["one", "two"]);
	assert.deepEqual(
		first.rows.map((row) => row.data.title),
		["one"],
	);
	assert.deepEqual(
		second.rows.map((row) => row.data.title),
		["two"],
	);
	assert.equal(first.confirmed.complete && second.confirmed.complete, true);
});

test("in-flight summary coverage does not suppress a missing detail representation", {
	timeout: 5000,
}, async (t) => {
	const response = deferred<ObservationBatch>();
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "summary",
					mode: "list",
					fields: ["title"],
					membership: true,
					run: async () => {
						calls.push("summary");
						return response.promise;
					},
				},
				{
					key: "notes",
					mode: "one",
					fields: ["notes"],
					run: async (request) => {
						calls.push("notes");
						return {
							facts: [fact(request.identity, { notes: "Bring water" })],
						};
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(list(["title"]));
	void first.catch(() => undefined);
	await until(() => calls.includes("summary"));
	const detail = await runtime.read(one("a", ["notes"]));
	assert.equal(detail.rows[0]?.data.notes, "Bring water");
	assert.deepEqual(calls, ["summary", "notes"]);
	response.resolve({
		facts: [fact("a", { title: "A" })],
		memberships: [collection(["a"])],
	});
	assert.equal((await first).rows[0]?.data.title, "A");
});

test("joint acquisition minimizes a whole set rather than choosing the cheapest local step", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "pair",
					mode: "one",
					fields: ["a", "b"],
					cost: 1,
					run: async () => {
						calls.push("pair");
						return { facts: [fact("x", { a: 1, b: 2 })] };
					},
				},
				{
					key: "tail",
					mode: "one",
					fields: ["c"],
					cost: 1.5,
					run: async () => {
						calls.push("tail");
						return { facts: [fact("x", { c: 3 })] };
					},
				},
				{
					key: "full",
					mode: "one",
					fields: ["a", "b", "c"],
					cost: 2.1,
					run: async () => {
						calls.push("full");
						return { facts: [fact("x", { a: 1, b: 2, c: 3 })] };
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const results = await Promise.all(
		["a", "b", "c"].map((field) => runtime.read(one("x", [field]))),
	);
	assert.equal(
		results.every((result) => result.rows[0]?.complete),
		true,
	);
	assert.deepEqual(calls, ["full"]);
});

test("projected sources acquire a new field without duplicating fields already in flight", {
	timeout: 5000,
}, async (t) => {
	const title = deferred<ObservationBatch>();
	const requests: string[][] = [];
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "projected",
					mode: "one",
					fields: ["title", "notes"],
					select: true,
					cost: (request) => Math.max(1, request.fields.length),
					run: async (request) => {
						requests.push([...request.fields]);
						if (request.fields.length === 1 && request.fields[0] === "title")
							return title.promise;
						return {
							facts: [
								fact(
									request.identity,
									Object.fromEntries(
										request.fields.map((field) => [
											field,
											field === "title" ? "Walk" : "Bring water",
										]),
									),
								),
							],
						};
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(one("a", ["title"]));
	void first.catch(() => undefined);
	await until(() => requests.length === 1);
	const second = await runtime.read(one("a", ["notes"]));
	assert.equal(second.rows[0]?.data.notes, "Bring water");
	assert.deepEqual(requests, [["title"], ["notes"]]);
	title.resolve({ facts: [fact("a", { title: "Walk" })] });
	assert.equal((await first).rows[0]?.data.title, "Walk");
});
