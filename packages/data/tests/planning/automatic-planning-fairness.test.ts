// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";

test("one large incomplete consumer cannot starve another consumer's supported acquisition", {
	timeout: 10000,
}, async (t) => {
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{ name: "incomplete", access: () => "public", sources: [] },
			{
				name: "tasks",
				access: () => "public",
				sources: [
					{
						key: "title",
						mode: "one",
						fields: ["title"],
						async run(request) {
							reads++;
							return {
								facts: [
									{
										resource: "tasks",
										identity: request.identity,
										presence: "present" as const,
										values: { title: "Ready" },
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
	const identities = Array.from({ length: 4200 }, (_, index) => String(index));
	runtime.observe({
		facts: identities.map((identity) => ({
			resource: "incomplete",
			identity,
			presence: "present" as const,
			values: { title: "Known" },
			basis: ["public"],
		})),
		memberships: [
			{ resource: "incomplete", identities, complete: true, basis: ["public"] },
		],
	});
	const [partial, ready] = await Promise.all([
		runtime.read(
			query({ resource: "incomplete", mode: "list", select: ["notes"] }),
		),
		runtime.read(
			query({
				resource: "tasks",
				mode: "one",
				identity: "walk",
				select: ["title"],
			}),
		),
	]);
	assert.equal(partial.settled, true);
	assert.ok(partial.rows.some((row) => !row.complete));
	assert.equal(ready.rows[0]?.data.title, "Ready");
	assert.equal(reads, 1);
});
