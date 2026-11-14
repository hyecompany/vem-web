// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { defineResource } from "@hyecompany/vem-data";
import {
	createRuntime,
	type ObservationBatch,
} from "@hyecompany/vem-data/runtime";
import {
	pagedTasks,
	taskSources,
} from "../../examples/integration/planning.js";

const tasks = defineResource<
	{ title: string; status: string; notes: string },
	{ id: string }
>()({ name: "tasks", fields: ["title", "status", "notes"] });
const evidence = (ids: string[]): ObservationBatch => ({
	facts: ids.map((id) => ({
		resource: "tasks",
		identity: { id },
		presence: "present",
		values: { title: id, status: "open", notes: id },
		basis: ["public"],
	})),
});
test("documented source capabilities choose shared work for the entire outstanding demand", async (t) => {
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: taskSources({
					async all() {
						calls.push("all");
						return {
							...evidence(["a", "b", "c", "d"]),
							memberships: [
								{
									resource: "tasks",
									identities: ["a", "b", "c", "d"].map((id) => ({ id })),
									complete: true,
									basis: ["public"],
								},
							],
						};
					},
					async one(id) {
						calls.push(id);
						return evidence([id]);
					},
				}),
			},
		],
	});
	t.after(() => runtime.close());
	const identities = ["a", "b", "c", "d"].map((id) => ({ id }));
	runtime.observe({
		facts: identities.map((identity) => ({
			resource: "tasks",
			identity,
			presence: "present",
			values: {},
			basis: ["public"],
		})),
		memberships: [
			{ resource: "tasks", identities, complete: true, basis: ["public"] },
		],
	});
	await Promise.all(
		["a", "b", "c", "d"].map((id) =>
			runtime.read(tasks.get({ id }, { select: ["notes"] })),
		),
	);
	assert.deepEqual(calls, ["all"]);
	await runtime.read(
		tasks.list({ select: ["title"], where: { status: "open" } }),
	);
	assert.deepEqual(calls, ["all"]);
});
test("documented pagination delegates continuation and supported filter handling to Vem", async (t) => {
	const urls: URL[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				sources: [
					pagedTasks(async (url) => {
						urls.push(url);
						const second = url.searchParams.has("cursor");
						return {
							tasks: [
								{
									id: second ? "b" : "a",
									title: second ? "B" : "A",
									status: "open",
								},
							],
							next: second ? undefined : "two",
							complete: second,
						};
					}),
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(
		tasks.list({ select: ["title"], where: { status: "open" } }),
	);
	assert.equal(result.confirmed.complete, true);
	assert.equal(result.rows.length, 2);
	assert.deepEqual(
		urls.map((url) => url.searchParams.get("status")),
		["open", "open"],
	);
	assert.deepEqual(
		urls.map((url) => url.searchParams.get("cursor")),
		[null, "two"],
	);
});
