// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { QueryMatching } from "../../src/read-model/query-matching.js";
import { fact, list } from "../support/acquisition.js";

test("population costs retain historical inventories but reject incomplete or withdrawn support", async (t) => {
	for (const state of [
		"partial",
		"interrupted",
		"withdrawn",
		"partial-survives",
		"unknown",
	] as const) {
		const calls: string[] = [];
		const runtime = createRuntime({
			access: [{ scope: "inventory", state: "allowed" }],
			resources: [
				{
					name: "tasks",
					access: () => "public",
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title"],
							membership: true,
							run: async () => {
								calls.push("collection");
								return {
									facts: [
										fact("0", { title: "Zero" }),
										fact("1", { title: "One" }),
									],
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
									facts: [
										fact(String(request.identity), { title: request.identity }),
									],
								};
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		const feed = { channel: "tasks" };
		runtime.setContinuity(feed, "live");
		runtime.observe({
			facts: [fact("0", {}), fact("1", {})],
			memberships:
				state === "unknown"
					? []
					: [
							{
								resource: "tasks",
								identities: ["0", "1"],
								complete: state !== "partial",
								basis: ["inventory"],
								liveness: feed,
							},
						],
		});
		if (state === "interrupted") runtime.setContinuity(feed, "interrupted");
		if (state === "partial-survives")
			runtime.observe({
				memberships: [
					{
						resource: "tasks",
						identities: ["0", "1"],
						complete: false,
						basis: ["public"],
						liveness: feed,
					},
				],
			});
		if (state === "withdrawn" || state === "partial-survives")
			runtime.revoke("inventory");
		const results = await Promise.all(
			["0", "1"].map((identity) =>
				runtime.read(
					query({
						resource: "tasks",
						mode: "one",
						identity,
						select: ["title"],
					}),
				),
			),
		);
		assert.ok(results.every((result) => result.confirmed.complete));
		// The retained inventory shows that one collection covers exactly both needed identities.
		assert.deepEqual(
			calls.sort(),
			state === "interrupted" ? ["collection"] : ["0", "1"],
			state,
		);
	}
});

test("source population follows supported filters and current known filter values", async (t) => {
	for (const scenario of ["unsupported", "equality", "custom"] as const) {
		const supportsFilter = scenario !== "unsupported";
		const calls: string[] = [];
		const identities = Array.from({ length: 100 }, (_, index) => String(index));
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					access: () => "public",
					...(scenario === "custom"
						? {
								queryDependencies: () => ["status"],
								matches: (
									values: Readonly<Record<string, unknown>>,
									where: Readonly<Record<string, unknown>>,
								) =>
									Object.entries(where).every(
										([field, expected]) => values[field] === expected,
									),
							}
						: {}),
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title", "status"],
							membership: true,
							filters: supportsFilter ? ["status"] : [],
							run: async (request) => {
								calls.push("collection");
								assert.deepEqual(request.where, { status: "open" });
								return {
									facts: [
										fact("0", { title: "Zero", status: "open" }),
										fact("1", { title: "One", status: "open" }),
									],
								};
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["title", "status"],
							run: async (request) => {
								calls.push(String(request.identity));
								return {
									facts: [
										fact(String(request.identity), {
											title: request.identity,
											status: "open",
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
		runtime.observe({
			facts: identities.map((id) =>
				fact(id, { status: Number(id) < 2 ? "open" : "closed" }),
			),
			memberships: [
				{ resource: "tasks", identities, complete: true, basis: ["public"] },
			],
		});
		const result = await runtime.read(
			query({
				resource: "tasks",
				mode: "list",
				where: { status: "open" },
				select: ["title"],
			}),
		);
		assert.equal(result.confirmed.complete, true);
		assert.equal(result.rows.length, 2);
		assert.deepEqual(
			calls.sort(),
			scenario === "equality" ? ["collection"] : ["0", "1"],
		);
	}
});

test("item costs price pagination continuation requests when comparing joint reads", async (t) => {
	for (const paginated of [false, true]) {
		const calls: string[] = [];
		const identities = ["0", "1", "2", "3", "4"];
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					access: () => "public",
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title"],
							membership: true,
							cost: () => ({ request: 1, perItem: 0 }),
							...(paginated ? { pagination: { pageSize: 1 } } : {}),
							run: async () => {
								calls.push("collection");
								return {
									facts: identities.map((id) => fact(id, { title: id })),
								};
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["title"],
							cost: 1,
							run: async (request) => {
								calls.push(String(request.identity));
								return {
									facts: [
										fact(String(request.identity), { title: request.identity }),
									],
								};
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe({
			facts: identities.map((id) => fact(id, {})),
			memberships: [
				{ resource: "tasks", identities, complete: true, basis: ["public"] },
			],
		});
		await Promise.all(
			["0", "1"].map((identity) =>
				runtime.read(
					query({
						resource: "tasks",
						mode: "one",
						identity,
						select: ["title"],
					}),
				),
			),
		);
		assert.deepEqual(calls.sort(), paginated ? ["0", "1"] : ["collection"]);
	}
});

test("population planning reuses confirmed projection through enrichment and new identities", async (t) => {
	let populationRows = 0;
	let featureRows = 0;
	const row = QueryMatching.prototype.row;
	t.mock.method(
		QueryMatching.prototype,
		"row",
		function (this: QueryMatching, ...args: Parameters<typeof row>) {
			if (args[0].select.length === 0) populationRows++;
			else featureRows++;
			return row.apply(this, args);
		},
	);
	for (const scenario of ["enriched", "created", "no-inventory"] as const) {
		const calls: string[] = [];
		const identities = Array.from({ length: 5 }, (_, index) => String(index));
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					access: () => "public",
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title"],
							membership: true,
							run: async () => {
								calls.push("collection");
								return {
									facts: identities.map((id) => fact(id, { title: id })),
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
									facts: [
										fact(String(request.identity), { title: request.identity }),
									],
								};
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe({
			facts: identities.map((id) => fact(id, {})),
			memberships:
				scenario === "no-inventory"
					? []
					: [
							{
								resource: "tasks",
								identities,
								complete: true,
								basis: ["public"],
							},
						],
		});
		runtime.observe({ facts: [fact("0", { title: "Zero" })] });
		if (scenario !== "enriched")
			runtime.observe({
				facts: Array.from({ length: 5 }, (_, index) =>
					fact(String(index + 5), {}),
				),
			});
		await Promise.all(
			["1", "2", "3"].map((identity) =>
				runtime.read(
					query({
						resource: "tasks",
						mode: "one",
						identity,
						select: ["title"],
					}),
				),
			),
		);
		assert.deepEqual(calls.sort(), ["1", "2", "3"], scenario);
	}
	assert.equal(
		populationRows,
		0,
		"cost estimates do not materialize presentation rows",
	);
	assert.ok(
		featureRows > 0,
		"normal feature projections still materialize rows",
	);
});

test("an unknown population still acquires once and cannot prove emptiness", async (t) => {
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "tasks",
				access: () => "public",
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["title"],
						membership: true,
						pagination: { pageSize: 10 },
						run: async () => {
							reads++;
							return { batch: {} };
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(list);
	assert.equal(reads, 1);
	assert.equal(result.empty, false);
	assert.equal(result.confirmed.complete, false);
});

test("automatic costs use actual population without guessing an unknown collection size", async (t) => {
	for (const [population, requested, inventory, bulk] of [
		[5, 5, true, true],
		[5, 3, true, false],
		[500, 5, true, false],
		[5000, 12, false, false],
	] as const) {
		const ids = Array.from({ length: population }, (_, index) => String(index));
		const wanted = ids.slice(0, requested);
		const calls: string[] = [];
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title"],
							membership: true,
							run: async () => {
								calls.push("collection");
								return { facts: ids.map((id) => fact(id, { title: id })) };
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["title"],
							run: async (request) => {
								const id = String(request.identity);
								calls.push(id);
								return { facts: [fact(id, { title: id })] };
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		if (inventory)
			runtime.observe({
				facts: ids.map((id) => fact(id, {})),
				memberships: [
					{
						resource: "tasks",
						identities: ids,
						complete: true,
						basis: ["public"],
					},
				],
			});
		const results = await Promise.all(
			wanted.map((identity) =>
				runtime.read(
					query({
						resource: "tasks",
						mode: "one",
						identity,
						select: ["title"],
					}),
				),
			),
		);
		assert.ok(results.every((result) => result.rows[0]?.complete));
		assert.deepEqual(calls.sort(), bulk ? ["collection"] : wanted.sort());
	}
});

test("unresolved filter candidates remain a population bound until their values are established", async (t) => {
	for (const resolved of [false, true]) {
		const ids = Array.from({ length: 10 }, (_, index) => String(index));
		const calls: string[] = [];
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					sources: [
						{
							key: "filtered",
							mode: "list",
							fields: ["title", "status"],
							filters: ["status"],
							membership: true,
							run: async (request) => {
								calls.push("filtered");
								assert.deepEqual(request.where, { status: "open" });
								return {
									facts: ["0", "1"].map((id) =>
										fact(id, { title: id, status: "open" }),
									),
								};
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["title", "status"],
							run: async (request) => {
								const id = String(request.identity);
								calls.push(id);
								return { facts: [fact(id, { title: id, status: "open" })] };
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe({
			facts: ids.map((id) =>
				fact(
					id,
					Number(id) < 2
						? { status: "open" }
						: resolved
							? { status: "closed" }
							: {},
				),
			),
			memberships: [
				{
					resource: "tasks",
					identities: ids,
					complete: true,
					basis: ["public"],
				},
			],
		});
		const results = await Promise.all(
			["0", "1"].map((identity) =>
				runtime.read(
					query({
						resource: "tasks",
						mode: "one",
						identity,
						select: ["title"],
						where: { status: "open" },
					}),
				),
			),
		);
		assert.ok(results.every((result) => result.rows[0]?.complete));
		assert.deepEqual(calls.sort(), resolved ? ["filtered"] : ["0", "1"]);
	}
});

test("invalid or incomparable source costs fail before any acquisition", async (t) => {
	for (const [detail, collection, message] of [
		[1, undefined, /comparable costs for every source/],
		[-1, 1, /finite positive cost/],
		[Number.NaN, 1, /finite positive cost/],
		[{ request: 1, perItem: -1 }, 1, /Invalid item-based acquisition cost/],
	] as const) {
		let reads = 0;
		const run = async () => {
			reads++;
			return { facts: [fact("0", { title: "Zero" })] };
		};
		const runtime = createRuntime({
			resources: [
				{
					name: "tasks",
					sources: [
						{
							key: "detail",
							mode: "one",
							fields: ["title"],
							cost: detail,
							run,
						},
						{
							key: "collection",
							mode: "list",
							fields: ["title"],
							membership: true,
							cost: collection,
							run,
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		const result = await runtime.read(
			query({
				resource: "tasks",
				mode: "one",
				identity: "0",
				select: ["title"],
			}),
		);
		assert.equal(reads, 0);
		assert.equal(result.confirmed.complete, false);
		assert.ok(result.issues.some((issue) => message.test(issue.message)));
	}
});
