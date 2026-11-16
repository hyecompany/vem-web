// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	defineResource,
	matchesFilter,
	matchesWhere,
	query,
	stableKey,
	type Where,
} from "@hyecompany/vem-data";

interface Item {
	name: string;
	description?: string;
	priority: number;
	config: { contains: string };
	tags: string[];
}
const items = defineResource<Item, string>()({
	name: "items",
	fields: ["name", "description", "priority", "config", "tags"],
	defaultSelect: ["name"],
});

test("where normalizes equivalent descriptions without changing selected fields", () => {
	const simple = items.list({ where: { name: "one", priority: 2 } });
	const explicit = items.list({
		where: { $and: [{ priority: { eq: 2 } }, { name: { eq: "one" } }] },
	});
	assert.equal(stableKey(simple), stableKey(explicit));
	assert.deepEqual(simple.where, { name: "one", priority: 2 });
	assert.deepEqual(simple.select, ["name"]);
	const first = items.list({
		where: {
			$or: [{ name: { contains: "a" } }, { description: { contains: "b" } }],
		},
	});
	const reordered = items.list({
		where: {
			$or: [
				{ description: { contains: "b" } },
				{ name: { contains: "a", case: "sensitive" } },
			],
		},
	});
	assert.equal(stableKey(first), stableKey(reordered));
	assert.equal(Object.isFrozen(first.where), true);
	const named = query({
		resource: "property-keys",
		mode: "list",
		select: [],
		where: { ["__proto__"]: "ordinary", constructor: "also ordinary" },
	});
	assert.equal(Object.hasOwn(named.where ?? {}, "__proto__"), true);
	assert.equal(
		matchesFilter(
			{ ["__proto__"]: "ordinary", constructor: "also ordinary" },
			named.where,
		),
		true,
	);
	assert.equal(Object.getPrototypeOf(named.where), Object.prototype);
});

test("literal object and array equality survive descriptor cloning without becoming operators", () => {
	const config = { contains: "literal" };
	const where: Where<Item> = {
		config: { eq: config },
		tags: { eq: ["first", "second"] },
	};
	const descriptor = items.list({ where });
	const copied = query({ ...descriptor });
	assert.equal(stableKey(copied), stableKey(descriptor));
	assert.equal(
		matchesFilter(
			{ config: { contains: "literal" }, tags: ["first", "second"] },
			copied.where,
		),
		true,
	);
	assert.equal(
		matchesWhere<Item>(
			{ config: { contains: "other" }, tags: ["first", "second"] },
			where,
		),
		false,
	);
	config.contains = "changed";
	assert.equal(
		matchesFilter(
			{ config: { contains: "literal" }, tags: ["first", "second"] },
			descriptor.where,
		),
		true,
	);
});

test("matching preserves unknown and explicitly unset fields through boolean groups", () => {
	assert.equal(
		matchesWhere<Item>({}, { description: { eq: undefined } }),
		"unknown",
	);
	assert.equal(
		matchesWhere<Item>(
			{ description: undefined },
			{ description: { eq: undefined } },
		),
		true,
	);
	assert.equal(
		matchesWhere<Item>(
			{ description: undefined },
			{ description: { contains: "x" } },
		),
		false,
	);
	assert.equal(
		matchesWhere<Item>(
			{ name: "yes" },
			{
				$or: [{ name: "yes" }, { description: { contains: "x" } }],
			},
		),
		true,
	);
	assert.equal(
		matchesWhere<Item>(
			{ name: "no" },
			{
				$or: [{ name: "yes" }, { description: { contains: "x" } }],
			},
		),
		"unknown",
	);
	assert.equal(matchesWhere<Item>({}, { $and: [] }), true);
	assert.equal(matchesWhere<Item>({}, { $or: [] }), false);
	assert.equal(
		matchesWhere<Item>({ name: "ONE" }, { name: { contains: "one" } }),
		false,
	);
	assert.equal(
		matchesWhere<Item>(
			{ name: "ONE" },
			{ name: { contains: "one", case: "insensitive" } },
		),
		true,
	);
	assert.equal(
		matchesWhere<Item>(
			{ name: "café" },
			{ name: { contains: "cafe", case: "insensitive" } },
		),
		false,
	);
});

test("invalid where conditions and undeclared fields fail during description construction", () => {
	for (const where of [
		{ $or: "not-an-array" },
		{ $and: [null] },
		{ $unknown: [] },
		{ name: { contains: 4 } },
		{ name: { contains: "x", case: "folded" } },
		{ name: { contains: "x", eq: "x" } },
		{ config: { contains: "literal", unknown: "not-an-operator" } },
		{ tags: ["implicit-array"] },
	]) {
		assert.throws(
			() => query({ resource: "items", mode: "list", select: [], where }),
			TypeError,
		);
	}
	assert.throws(
		() => items.list({ where: { unknown: "x" } as Where<Item> }),
		/Unknown items field: unknown/,
	);
});
