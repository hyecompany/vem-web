// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../../src/index.js";
import { createRuntime } from "../../src/runtime.js";

test("authoritative deletion invalidates field and relationship truth dependencies while retaining permitted prior values", () => {
	const runtime = createRuntime({ resources: [{ name: "items" }] });
	const field = runtime.watch(
		query({
			resource: "items",
			mode: "one",
			identity: "field-output",
			select: ["value"],
		}),
	);
	const relation = runtime.watch(
		query({
			resource: "items",
			mode: "one",
			identity: "relation-output",
			select: ["value"],
		}),
	);
	try {
		runtime.observe({
			facts: [
				{
					resource: "items",
					identity: "source",
					values: { name: "input" },
					presence: "present",
					basis: ["public"],
				},
			],
			relationships: [
				{
					resource: "items",
					identity: "source",
					relationship: "uses",
					targets: [{ resource: "items", identity: "target" }],
					complete: true,
					basis: ["public"],
				},
			],
		});
		runtime.observe({
			facts: [
				{
					resource: "items",
					identity: "field-output",
					values: { value: "from input" },
					basis: ["public"],
					dependsOn: [{ resource: "items", identity: "source", field: "name" }],
				},
				{
					resource: "items",
					identity: "relation-output",
					values: { value: 1 },
					basis: ["public"],
					dependsOn: [
						{ resource: "items", identity: "source", relationship: "uses" },
					],
				},
			],
		});
		assert.equal(field.getSnapshot().rows[0]?.fields.value?.stale, undefined);
		assert.equal(
			relation.getSnapshot().rows[0]?.fields.value?.stale,
			undefined,
		);
		runtime.observe({
			facts: [
				{
					resource: "items",
					identity: "source",
					presence: "absent",
					basis: ["public"],
				},
			],
		});
		assert.equal(field.getSnapshot().rows[0]?.data.value, "from input");
		assert.equal(field.getSnapshot().rows[0]?.fields.value?.stale, true);
		assert.equal(relation.getSnapshot().rows[0]?.data.value, 1);
		assert.equal(relation.getSnapshot().rows[0]?.fields.value?.stale, true);
		assert.equal(runtime.relationship("items", "source", "uses"), undefined);
	} finally {
		field.dispose();
		relation.dispose();
		runtime.close();
	}
});

test("an unsupported absence observation cannot delete independently permitted resource fields", () => {
	const runtime = createRuntime({ resources: [{ name: "items" }] });
	const handle = runtime.watch(
		query({
			resource: "items",
			mode: "one",
			identity: "source",
			select: ["name"],
		}),
	);
	try {
		runtime.observe({
			facts: [
				{
					resource: "items",
					identity: "source",
					values: { name: "retained" },
					presence: "present",
					basis: ["public"],
				},
			],
		});
		runtime.observe({
			facts: [
				{
					resource: "items",
					identity: "source",
					presence: "absent",
					basis: [],
				},
			],
		});
		assert.equal(handle.getSnapshot().rows[0]?.data.name, "retained");
		assert.equal(handle.getSnapshot().exists, true);
	} finally {
		handle.dispose();
		runtime.close();
	}
});
