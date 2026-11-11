// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100 && !predicate(); i++) await tick();
	assert.ok(predicate());
}

test("a new field demand replans queued acquisition before either consumer is marked attempted", async (t) => {
	const held = deferred<ObservationBatch>();
	const executed: string[][] = [];
	const executionOrder: string[] = [];
	const runtime = createRuntime({
		maxConcurrent: 1,
		resources: [
			{
				name: "blocker",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name"],
						membership: true,
						run: async () => held.promise,
					},
				],
			},
			{
				name: "widgets",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "description"],
						membership: true,
						select: true,
						run: async (request) => {
							const fields = [...request.fields].sort();
							executionOrder.push("widgets");
							executed.push(fields);
							return {
								facts: [
									{
										resource: "widgets",
										identity: "one",
										presence: "present",
										values: Object.fromEntries(
											fields.map((field) => [field, field]),
										),
										basis: ["public"],
									},
								],
								memberships: [
									{
										resource: "widgets",
										identities: ["one"],
										complete: true,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
			},
			{
				name: "later",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name"],
						membership: true,
						run: async () => {
							executionOrder.push("later");
							return {
								memberships: [
									{
										resource: "later",
										identities: [],
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
	const blocker = runtime.watch(
		query({ resource: "blocker", mode: "list", select: ["name"] }),
	);
	const stopBlocker = blocker.subscribe(() => undefined);
	t.after(stopBlocker);
	await until(() => blocker.getSnapshot().fetching);
	const first = runtime.watch(
		query({ resource: "widgets", mode: "list", select: ["name"] }),
	);
	const stopFirst = first.subscribe(() => undefined);
	t.after(stopFirst);
	await until(() => first.getSnapshot().fetching);
	const later = runtime.watch(
		query({ resource: "later", mode: "list", select: ["name"] }),
	);
	const stopLater = later.subscribe(() => undefined);
	t.after(stopLater);
	await until(() => later.getSnapshot().fetching);
	const second = runtime.watch(
		query({ resource: "widgets", mode: "list", select: ["description"] }),
	);
	const stopSecond = second.subscribe(() => undefined);
	t.after(stopSecond);
	await until(() => second.getSnapshot().fetching);
	held.resolve({
		memberships: [
			{
				resource: "blocker",
				identities: [],
				complete: true,
				basis: ["public"],
			},
		],
	});
	await until(
		() =>
			first.getSnapshot().settled &&
			second.getSnapshot().settled &&
			later.getSnapshot().settled,
	);
	assert.deepEqual(executed, [["description", "name"]]);
	assert.deepEqual(executionOrder, ["widgets", "later"]);
	assert.equal(first.getSnapshot().rows[0]?.complete, true);
	assert.equal(second.getSnapshot().rows[0]?.data.description, "description");
	assert.equal(second.getSnapshot().rows[0]?.complete, true);
});
