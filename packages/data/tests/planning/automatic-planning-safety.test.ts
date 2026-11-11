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
const fact = (
	identity: string,
	values: Record<string, unknown>,
	basis = "public",
) => ({
	resource: "tasks",
	identity,
	presence: "present" as const,
	values,
	basis: [basis],
});
const one = (select: readonly string[] = ["title"]) =>
	query({ resource: "tasks", mode: "one", identity: "a", select });
const list = query({ resource: "tasks", mode: "list", select: ["title"] });
const definition = (
	sources: ResourceDefinition["sources"],
	extra: Partial<ResourceDefinition> = {},
): ResourceDefinition => ({
	name: "tasks",
	access: () => "public",
	sources,
	...extra,
});

test("partial membership is not promoted by advertised capability and retries remain user-controlled", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "collection",
					mode: "list",
					fields: ["title"],
					membership: true,
					run: async () => {
						calls++;
						return {
							facts: [fact("a", { title: "A" })],
							memberships: [
								{
									resource: "tasks",
									identities: ["a"],
									complete: false,
									basis: ["public"],
								},
							],
						};
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const first = await runtime.read(list);
	assert.equal(first.settled, true);
	assert.equal(first.confirmed.complete, false);
	assert.equal(first.confirmed.total, undefined);
	assert.equal(first.rows[0]?.data.title, "A");
	assert.equal(calls, 1);
	await tick();
	assert.equal(calls, 1);
	const handle = runtime.watch(list);
	t.after(() => handle.dispose());
	const retried = await handle.retry();
	assert.equal(retried.settled, true);
	assert.equal(retried.confirmed.complete, false);
	assert.equal(calls, 2);
});

test("a failed source can fall back to another declared source without looping", {
	timeout: 5000,
}, async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		maxConcurrent: 1,
		resources: [
			definition([
				{
					key: "primary",
					mode: "one",
					fields: ["title"],
					cost: 1,
					run: async () => {
						calls.push("primary");
						throw new Error("Primary unavailable");
					},
				},
				{
					key: "secondary",
					mode: "one",
					fields: ["title"],
					cost: 2,
					run: async () => {
						calls.push("secondary");
						return { facts: [fact("a", { title: "A" })] };
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(one());
	assert.equal(result.rows[0]?.complete, true);
	assert.equal(result.rows[0]?.data.title, "A");
	assert.deepEqual(calls, ["primary", "secondary"]);
	await tick();
	assert.equal(calls.length, 2);
});

test("unavailable source and denied reads settle without dispatch or unsupported retry loops", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		access: [{ scope: "private", state: "denied" }],
		resources: [
			definition(
				[
					{
						key: "private",
						mode: "one",
						fields: ["title"],
						available: (_request, context) =>
							context.access("private") === "allowed",
						run: async () => {
							calls++;
							return { facts: [fact("a", { title: "Secret" }, "private")] };
						},
					},
				],
				{ access: () => "private" },
			),
		],
	});
	t.after(() => runtime.close());
	const denied = await runtime.read(one());
	assert.equal(denied.settled, true);
	assert.equal(
		denied.issues.some((issue) => issue.kind === "access"),
		true,
	);
	assert.equal(calls, 0);
	runtime.setAccess({ decisions: [{ scope: "private", state: "allowed" }] });
	const allowed = await runtime.read(one());
	assert.equal(allowed.rows[0]?.data.title, "Secret");
	assert.equal(calls, 1);
});

test("late automatic acquisition cannot replace newer event fields", {
	timeout: 5000,
}, async (t) => {
	const response = deferred<ObservationBatch>();
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "detail",
					mode: "one",
					fields: ["title", "notes"],
					run: async () => {
						calls++;
						return response.promise;
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const pending = runtime.read(one(["title", "notes"]));
	await until(() => calls === 1);
	runtime.observe({ facts: [fact("a", { title: "Current event" })] });
	response.resolve({
		facts: [fact("a", { title: "Old response", notes: "Still useful" })],
	});
	const result = await pending;
	assert.deepEqual(result.rows[0]?.data, {
		title: "Current event",
		notes: "Still useful",
	});
	assert.equal(calls, 1);
});

test("revocation and regrant reject old source evidence and permit new acquisition", {
	timeout: 5000,
}, async (t) => {
	const old = deferred<ObservationBatch>();
	let calls = 0;
	const runtime = createRuntime({
		access: [{ scope: "private", state: "allowed" }],
		resources: [
			definition(
				[
					{
						key: "detail",
						mode: "one",
						fields: ["title"],
						run: async () =>
							++calls === 1
								? old.promise
								: { facts: [fact("a", { title: "Current grant" }, "private")] },
					},
				],
				{ access: () => "private" },
			),
		],
	});
	t.after(() => runtime.close());
	const handle = runtime.watch(one());
	const seen: unknown[] = [];
	t.after(
		handle.subscribe(() => seen.push(handle.getSnapshot().rows[0]?.data.title)),
	);
	await until(() => calls === 1);
	runtime.revoke("private");
	runtime.setAccess({ decisions: [{ scope: "private", state: "allowed" }] });
	old.resolve({ facts: [fact("a", { title: "Retired grant" }, "private")] });
	await until(() => calls === 2 && handle.getSnapshot().settled);
	assert.equal(seen.includes("Retired grant"), false);
	assert.equal(handle.getSnapshot().rows[0]?.data.title, "Current grant");
});

test("automatic source declarations cannot establish fields omitted from the actual response", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		resources: [
			definition([
				{
					key: "detail",
					mode: "one",
					fields: ["title", "notes"],
					run: async () => {
						calls++;
						return { facts: [fact("a", { title: "A" })] };
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(one(["title", "notes"]));
	assert.equal(result.settled, true);
	assert.equal(result.rows[0]?.complete, false);
	assert.deepEqual(result.rows[0]?.missing, ["notes"]);
	assert.equal(result.rows[0]?.data.title, "A");
	assert.equal(calls, 1);
});

test("granting source admission resumes an otherwise permitted read", {
	timeout: 5000,
}, async (t) => {
	let calls = 0;
	const runtime = createRuntime({
		access: [{ scope: "service", state: "denied" }],
		resources: [
			definition([
				{
					key: "source",
					mode: "one",
					fields: ["title"],
					access: "service",
					run: async () => {
						calls++;
						return { facts: [fact("a", { title: "Available" })] };
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const before = await runtime.read(one());
	assert.equal(before.settled, true);
	assert.equal(
		before.issues.some((issue) => issue.kind === "access"),
		true,
	);
	assert.equal(calls, 0);
	runtime.setAccess({ decisions: [{ scope: "service", state: "allowed" }] });
	const after = await runtime.read(one());
	assert.equal(after.rows[0]?.data.title, "Available");
	assert.equal(calls, 1);
});

test("source permission loss withdraws late failure details from otherwise public consumers", {
	timeout: 5000,
}, async (t) => {
	const response = deferred<ObservationBatch>();
	let entered = false;
	const runtime = createRuntime({
		access: [{ scope: "service", state: "allowed" }],
		resources: [
			definition([
				{
					key: "source",
					mode: "one",
					fields: ["title"],
					access: "service",
					run: async () => {
						entered = true;
						return response.promise;
					},
				},
			]),
		],
	});
	t.after(() => runtime.close());
	const handle = runtime.watch(one());
	const seen: string[] = [];
	t.after(
		handle.subscribe(() =>
			seen.push(...handle.getSnapshot().issues.map((issue) => issue.message)),
		),
	);
	await until(() => entered);
	runtime.revoke("service");
	response.reject(new Error("Protected server failure details"));
	const result = await runtime.read(one());
	assert.equal(result.settled, true);
	assert.equal(seen.includes("Protected server failure details"), false);
	assert.equal(
		result.issues.some(
			(issue) => issue.message === "Protected server failure details",
		),
		false,
	);
});
