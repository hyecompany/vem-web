// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isFilterExpression,
	matchesFilter,
	query,
	type Where,
} from "@hyecompany/vem-data";
import {
	type AcquisitionRequest,
	type AcquisitionSource,
	createRuntime,
	type ObservationBatch,
} from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";

const comparison = { case: "insensitive", accents: "sensitive" } as const;
const searchWhere = {
	$or: [
		{ name: { contains: "needle", ...comparison } },
		{ description: { contains: "needle", ...comparison } },
	],
};
const capabilities: AcquisitionSource["filters"] = {
	fields: ["name", "description"],
	operators: ["equal", "contains"],
	combinations: ["any", "all"],
	text: [comparison],
};
const names = (
	where: Where<{ name: string; description?: string }> = searchWhere,
) => query({ resource: "projects", mode: "list", select: ["name"], where });
const search = names().where;
function batch(
	rows: readonly { name: string; description?: string }[],
	where?: AcquisitionRequest["where"],
	complete = true,
): ObservationBatch {
	return {
		facts: rows.map((values) => ({
			resource: "projects",
			identity: values.name,
			presence: "present",
			values,
			basis: ["public"],
		})),
		memberships: [
			{
				resource: "projects",
				where,
				identities: rows.map((row) => row.name),
				complete,
				basis: ["public"],
			},
		],
	};
}

test("exact OR-filtered membership establishes matches without inventing fields or a matching branch", async (t) => {
	const calls: AcquisitionRequest["where"][] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				sources: [
					{
						key: "filtered-urls",
						mode: "list",
						fields: ["name"],
						membership: true,
						filters: capabilities,
						available: (request) => isFilterExpression(request.where),
						run: async (request) => {
							calls.push(request.where);
							return batch([{ name: "Alpha" }], request.where);
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(names());
	assert.deepEqual(calls, [search]);
	assert.equal(result.confirmed.complete, true);
	assert.equal(result.confirmed.total, 1);
	assert.equal(result.unresolved.length, 0);
	assert.deepEqual(
		result.rows.map((row) => row.data),
		[{ name: "Alpha" }],
	);
	const detail = runtime.watch(
		query({
			resource: "projects",
			mode: "one",
			identity: "Alpha",
			select: ["description"],
		}),
		{ acquire: false },
	);
	t.after(() => detail.dispose());
	assert.equal(detail.getSnapshot().rows[0]?.data.description, undefined);
	const branch = runtime.watch(
		names({ description: { contains: "needle", ...comparison } }),
		{ acquire: false },
	);
	t.after(() => branch.dispose());
	assert.equal(branch.getSnapshot().rows.length, 0);
	assert.equal(branch.getSnapshot().confirmed.complete, false);
	assert.equal(calls.length, 1);
});

test("unsupported filter operators, OR branches, text semantics, and source restrictions fall back to local matching", async (t) => {
	const rows = [
		{ name: "Alpha", description: "a needle" },
		{ name: "Beta", description: "other" },
	];
	const unsupported: AcquisitionSource["filters"][] = [
		["name", "description"],
		{
			fields: ["name", "description"],
			operators: ["equal"],
			combinations: ["any"],
			text: [comparison],
		},
		{
			fields: ["name"],
			operators: ["contains"],
			combinations: ["any"],
			text: [comparison],
		},
		{
			fields: ["name", "description"],
			operators: ["contains"],
			combinations: ["all"],
			text: [comparison],
		},
		{
			fields: ["name", "description"],
			operators: ["contains"],
			combinations: ["any"],
			text: [{ case: "sensitive", accents: "sensitive" }],
		},
		{ ...capabilities, supports: () => false },
	];
	for (const filters of unsupported) {
		const calls: AcquisitionRequest["where"][] = [];
		const runtime = createRuntime({
			resources: [
				{
					name: "projects",
					sources: [
						{
							key: "representations",
							mode: "list",
							fields: ["name", "description"],
							membership: true,
							filters,
							run: async (request) => {
								calls.push(request.where);
								return batch(rows, request.where);
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		const result = await runtime.read(names());
		assert.deepEqual(calls, [undefined]);
		assert.equal(result.confirmed.complete, true);
		assert.deepEqual(
			result.rows.map((row) => row.data.name),
			["Alpha"],
		);
	}
});

test("a complete known collection evaluates compound literal text filters without acquisition", async (t) => {
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				sources: [
					{
						key: "unexpected",
						mode: "list",
						fields: ["name", "description"],
						membership: true,
						run: async () => {
							reads++;
							throw new Error("Known fields must not be fetched");
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe(
		batch([
			{ name: "Café", description: "meal" },
			{ name: "CAFE", description: "trip" },
			{ name: "x[.]y", description: "literal punctuation" },
			{ name: "xZZy", description: "not a regular expression match" },
		]),
	);
	const cases = [
		{
			where: { name: { contains: "cafe", ...comparison } },
			expected: ["CAFE"],
		},
		{
			where: {
				name: {
					contains: "cafe",
					case: "insensitive",
					accents: "insensitive",
				},
			},
			expected: ["CAFE", "Café"],
		},
		{ where: { name: { contains: "[.]" } }, expected: ["x[.]y"] },
		{
			where: {
				$and: [
					{ $or: [{ name: "Café" }, { name: "CAFE" }] },
					{ description: { contains: "meal" } },
				],
			},
			expected: ["Café"],
		},
	] as const;
	for (const { where, expected } of cases) {
		const result = await runtime.read(names(where));
		assert.equal(result.confirmed.complete, true);
		assert.deepEqual(
			result.rows.map((row) => row.data.name).sort(),
			[...expected].sort(),
		);
	}
	assert.equal(reads, 0);
	assert.equal(matchesFilter({ name: "no" }, search), "unknown");
	assert.equal(
		matchesFilter({ name: "needle", description: undefined }, search),
		true,
	);
	assert.equal(isFilterExpression(search), true);
	assert.equal(
		isFilterExpression({
			$filter: "contains",
			field: "name",
			value: 42,
			comparison,
		}),
		false,
	);
	assert.equal(
		isFilterExpression({ $filter: "regex", field: "name", value: ".*" }),
		false,
	);
});

test("partial cached membership uses the supported backend predicate instead of enumerating unrelated projects", async (t) => {
	const calls: AcquisitionRequest["where"][] = [];
	let supported = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				sources: [
					{
						key: "search",
						cost: (request) => (request.where ? 1 : 10),
						mode: "list",
						fields: ["name"],
						membership: true,
						filters: {
							...capabilities,
							supports: (expression) => {
								supported++;
								return isFilterExpression(expression);
							},
						},
						run: async (request) => {
							calls.push(request.where);
							return batch([{ name: "Needle project" }], request.where);
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe(
		batch([{ name: "Other", description: "not matching" }], undefined, false),
	);
	const result = await runtime.read(names());
	assert.ok(supported > 0);
	assert.deepEqual(calls, [search]);
	assert.deepEqual(
		result.rows.map((row) => row.data.name),
		["Needle project"],
	);
	assert.equal(result.confirmed.complete, true);
});

test("predicate evidence follows invalidation and cannot disclose a denied filter field", async (t) => {
	const runtime = createRuntime({
		access: [{ scope: "description:read", state: "allowed" }],
		resources: [
			{ name: "projects", fieldAccess: { description: "description:read" } },
		],
	});
	t.after(() => runtime.close());
	runtime.observe(batch([{ name: "Alpha" }], search));
	const view = runtime.watch(names(), { acquire: false });
	t.after(view.subscribe(() => undefined));
	assert.equal(view.getSnapshot().confirmed.complete, true);
	assert.equal(view.getSnapshot().rows.length, 1);
	runtime.observe({
		invalidate: [
			{ resource: "projects", identity: "Alpha", field: "description" },
		],
	});
	assert.equal(view.getSnapshot().confirmed.complete, false);
	assert.equal(view.getSnapshot().stale, true);
	runtime.observe(batch([{ name: "Alpha" }], search));
	assert.equal(view.getSnapshot().confirmed.complete, true);
	runtime.revoke("description:read");
	assert.equal(view.getSnapshot().rows.length, 0);
	assert.equal(view.getSnapshot().confirmed.complete, false);
	assert.ok(view.getSnapshot().issues.some((issue) => issue.kind === "access"));
	const publicName = runtime.watch(
		query({
			resource: "projects",
			mode: "one",
			identity: "Alpha",
			select: ["name"],
		}),
		{ acquire: false },
	);
	t.after(() => publicName.dispose());
	assert.equal(publicName.getSnapshot().rows[0]?.data.name, "Alpha");
});

test("later filtered consumers reuse fields already covered by an in-flight representation", {
	timeout: 5000,
}, async (t) => {
	const started = deferred<void>();
	const response = deferred<ObservationBatch>();
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				sources: [
					{
						key: "search",
						mode: "list",
						fields: ["name", "description"],
						membership: true,
						filters: capabilities,
						run: async () => {
							reads++;
							started.resolve();
							return response.promise;
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const first = runtime.read(names());
	await started.promise;
	const second = runtime.read(
		query({
			resource: "projects",
			mode: "list",
			select: ["name", "description"],
			where: searchWhere,
		}),
	);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(reads, 1);
	response.resolve(
		batch([{ name: "Alpha", description: "needle notes" }], search),
	);
	const [namesOnly, described] = await Promise.all([first, second]);
	assert.equal(reads, 1);
	assert.equal(namesOnly.confirmed.complete, true);
	assert.equal(described.confirmed.complete, true);
	assert.deepEqual(namesOnly.rows[0]?.data, { name: "Alpha" });
	assert.deepEqual(described.rows[0]?.data, {
		name: "Alpha",
		description: "needle notes",
	});
});

test("native predicates keep their semantics when a domain also supplies a legacy matcher", async (t) => {
	let customCalls = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				matches(values, where) {
					assert.equal(isFilterExpression(where), false);
					customCalls++;
					return where.name === "legacy" && values.name === "Alpha";
				},
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe(
		batch([
			{ name: "Alpha", description: "needle notes" },
			{ name: "Beta", description: "other" },
		]),
	);
	const native = await runtime.read(
		names({ name: { contains: "alp", ...comparison } }),
	);
	assert.deepEqual(
		native.rows.map((row) => row.data.name),
		["Alpha"],
	);
	assert.equal(native.confirmed.complete, true);
	assert.equal(customCalls, 0);
	const legacy = runtime.watch(names({ name: "legacy" }), { acquire: false });
	t.after(() => legacy.dispose());
	assert.deepEqual(
		legacy.getSnapshot().rows.map((row) => row.data.name),
		["Alpha"],
	);
	assert.ok(customCalls > 0);
});

test("filtered read status follows another consumer's relevant detail work without requesting a collection", {
	timeout: 5000,
}, async (t) => {
	const started = deferred<void>();
	const response = deferred<ObservationBatch>();
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				sources: [
					{
						key: "description",
						mode: "one",
						fields: ["description"],
						run: async () => {
							reads++;
							started.resolve();
							return response.promise;
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	runtime.observe(batch([{ name: "Alpha" }], undefined, false));
	const status = runtime.watchReadStatus(names());
	const excluded = runtime.watchReadStatus(
		query({
			resource: "projects",
			mode: "list",
			select: ["description"],
			where: { name: { eq: "Beta" } },
		}),
	);
	t.after(() => status.dispose());
	t.after(() => excluded.dispose());
	t.after(status.subscribe(() => undefined));
	assert.equal(status.getSnapshot().pending, false);
	const read = runtime.read(
		query({
			resource: "projects",
			mode: "one",
			identity: "Alpha",
			select: ["description"],
		}),
	);
	await started.promise;
	assert.equal(status.getSnapshot().pending, true);
	assert.equal(excluded.getSnapshot().pending, false);
	response.resolve({
		facts: [
			{
				resource: "projects",
				identity: "Alpha",
				values: { description: "needle notes" },
				basis: ["public"],
			},
		],
	});
	await read;
	assert.equal(status.getSnapshot().pending, false);
	assert.deepEqual(status.getSnapshot().issues, []);
	assert.equal(reads, 1);
});

test("equality field capabilities keep the equality-map request contract for native predicates", async (t) => {
	const calls: AcquisitionRequest["where"][] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				sources: [
					{
						key: "names",
						mode: "list",
						fields: ["name"],
						membership: true,
						filters: ["name"],
						run: async (request) => {
							calls.push(request.where);
							return batch(
								[{ name: String(request.where?.name) }],
								request.where,
							);
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const result = await runtime.read(names({ name: { eq: "Alpha" } }));
	assert.deepEqual(calls, [{ name: "Alpha" }]);
	assert.deepEqual(
		result.rows.map((row) => row.data.name),
		["Alpha"],
	);
});

test("known filtered membership offers a cheaper recursive source to independent detail consumers", async (t) => {
	for (const stale of [false, true]) {
		const calls: { source: string; where?: AcquisitionRequest["where"] }[] = [];
		const rows = Array.from({ length: 500 }, (_, i) => ({
			name: `project-${i}`,
			description: i < 2 ? "needle" : "",
		}));
		const runtime = createRuntime({
			resources: [
				{
					name: "projects",
					matches: () => false,
					sources: [
						{
							key: "detail",
							mode: "one",
							fields: ["name", "description"],
							run: async (request) => {
								calls.push({ source: "detail" });
								return {
									facts: batch(
										rows.filter((row) => row.name === request.identity),
									).facts,
								};
							},
						},
						{
							key: "recursive",
							mode: "list",
							fields: ["name", "description"],
							membership: true,
							filters: capabilities,
							run: async (request) => {
								calls.push({ source: "recursive", where: request.where });
								return batch(
									rows.filter(
										(row) => matchesFilter(row, request.where) === true,
									),
									request.where,
								);
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe(batch(rows.map(({ name }) => ({ name }))));
		runtime.observe({
			memberships: [
				{
					resource: "projects",
					where: search,
					identities: ["project-0", "project-1"],
					complete: true,
					basis: ["public"],
				},
			],
		});
		if (stale)
			runtime.observe({
				invalidate: [
					{ resource: "projects", identity: "project-0", field: "description" },
					{ resource: "projects", identity: "project-1", field: "description" },
				],
			});
		const activeList = runtime.watch(names(), { acquire: false });
		t.after(() => activeList.dispose());
		const results = await Promise.all(
			["project-0", "project-1"].map((identity) =>
				runtime.read(
					query({
						resource: "projects",
						mode: "one",
						identity,
						select: ["description"],
					}),
				),
			),
		);
		assert.ok(
			results.every((result) => result.rows[0]?.data.description === "needle"),
		);
		assert.deepEqual(
			calls,
			stale
				? [{ source: "detail" }, { source: "detail" }]
				: [{ source: "recursive", where: search }],
		);
	}
});

for (const [label, select, orderBy] of [
	["identity-only", [], undefined],
	["name", ["name"], undefined],
	["description", ["description"], undefined],
	["sorted", ["name"], [{ field: "description" }]],
] as const) {
	test(`automatic filtered reads minimize total response for ${label} results`, async (t) => {
		const calls: string[] = [];
		const matches = [
			{ name: "zz-description", description: "needle" },
			{ name: "zzz-needle", description: "Other services" },
		];
		const runtime = createRuntime({
			resources: [
				{
					name: "projects",
					sources: [
						{
							key: "filtered",
							mode: "list",
							fields: ["name"],
							membership: true,
							filters: capabilities,
							async run(request) {
								calls.push("filtered");
								assert.deepEqual(request.where, search);
								return batch(
									matches.map(({ name }) => ({ name })),
									request.where,
								);
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["name", "description"],
							async run(request) {
								const name = String(request.identity);
								calls.push(name);
								return {
									facts: batch([
										matches.find((row) => row.name === name) ?? {
											name,
											description: "Other services",
										},
									]).facts,
								};
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe(
			batch([
				...Array.from({ length: 50 }, (_, i) => ({ name: `project-${i}` })),
				...matches.map(({ name }) => ({ name })),
			]),
		);
		const result = await runtime.read(
			query({
				resource: "projects",
				mode: "list",
				select,
				orderBy,
				where: searchWhere,
			}),
		);
		assert.equal(result.confirmed.complete, true);
		assert.equal(result.confirmed.total, 2);
		assert.equal(result.unresolved.length, 0);
		assert.ok(result.rows.every((row) => row.complete));
		assert.deepEqual(
			calls.sort(),
			select[0] === "description" || orderBy
				? ["filtered", "zz-description", "zzz-needle"]
				: ["filtered"],
		);
	});
}

test("unresolved lists retain readable output while acquiring custom match dependencies before display fields", async (t) => {
	const predicate = deferred<void>();
	const calls: string[] = [];
	const runtime = createRuntime({
		resources: [
			{
				name: "projects",
				queryDependencies: () => ["description"],
				matches: (values, where) =>
					typeof values.description === "string"
						? values.description.includes(String(where.description))
						: "unknown",
				sources: [
					{
						key: "predicate",
						mode: "one",
						fields: ["description"],
						async run(request) {
							const name = String(request.identity);
							calls.push(`predicate:${name}`);
							await predicate.promise;
							return {
								facts: batch([
									{
										name,
										description: name === "Alpha" ? "needle" : "Other services",
									},
								]).facts,
							};
						},
					},
					{
						key: "notes",
						mode: "one",
						fields: ["notes"],
						async run(request) {
							calls.push(`notes:${String(request.identity)}`);
							return {
								facts: [
									{
										resource: "projects",
										identity: request.identity,
										values: { notes: "Current note" },
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
	const initial = batch([{ name: "Alpha" }, { name: "Beta" }]);
	runtime.observe({
		...initial,
		facts: initial.facts?.map((fact) => ({
			...fact,
			values: { ...fact.values, notes: "Retained note" },
		})),
	});
	runtime.observe({
		invalidate: ["Alpha", "Beta"].map((identity) => ({
			resource: "projects",
			identity,
			field: "notes",
		})),
	});
	const view = runtime.watch(
		query({
			resource: "projects",
			mode: "list",
			select: ["name", "notes"],
			where: { description: "needle" },
			orderBy: [{ field: "notes" }],
		}),
	);
	t.after(view.subscribe(() => undefined));
	for (let i = 0; i < 100 && calls.length < 2; i++)
		await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(calls.sort(), ["predicate:Alpha", "predicate:Beta"]);
	assert.deepEqual(
		view.getSnapshot().unresolved.map((row) => row.data.notes),
		["Retained note", "Retained note"],
	);
	predicate.resolve();
	for (let i = 0; i < 100 && !view.getSnapshot().settled; i++)
		await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(calls.sort(), [
		"notes:Alpha",
		"predicate:Alpha",
		"predicate:Beta",
	]);
	assert.equal(view.getSnapshot().confirmed.complete, true);
	assert.deepEqual(
		view.getSnapshot().rows.map((row) => row.data),
		[{ name: "Alpha", notes: "Current note" }],
	);
});

for (const first of ["filtered list", "matching detail"] as const) {
	test(`filtered membership stays complete when the ${first} finishes first`, async (t) => {
		const filtered = deferred<ObservationBatch>();
		const detail = deferred<ObservationBatch>();
		const started = new Set<string>();
		const runtime = createRuntime({
			resources: [
				{
					name: "projects",
					sources: [
						{
							key: "filtered",
							mode: "list",
							fields: ["name"],
							membership: true,
							filters: capabilities,
							async run() {
								started.add("filtered");
								return filtered.promise;
							},
						},
						{
							key: "detail",
							mode: "one",
							fields: ["name", "description"],
							async run() {
								started.add("detail");
								return detail.promise;
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe(
			batch([
				...Array.from({ length: 500 }, (_, i) => ({ name: `project-${i}` })),
				{ name: "zz-description" },
				{ name: "zzz-needle" },
			]),
		);
		const view = runtime.watch(names());
		const stop = view.subscribe(() => undefined);
		const selected = runtime.watch(
			query({
				resource: "projects",
				mode: "one",
				identity: "zzz-needle",
				select: ["description"],
			}),
		);
		const stopSelected = selected.subscribe(() => undefined);
		for (let i = 0; i < 100 && started.size < 2; i++)
			await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(started.size, 2);
		stop();
		stopSelected();
		t.after(() => view.dispose());
		t.after(() => selected.dispose());
		const resolveFiltered = () =>
			filtered.resolve(
				batch([{ name: "zz-description" }, { name: "zzz-needle" }], search),
			);
		const resolveDetail = () =>
			detail.resolve({
				facts: batch([{ name: "zzz-needle", description: "Other services" }])
					.facts,
			});
		(first === "filtered list" ? resolveFiltered : resolveDetail)();
		await new Promise<void>((resolve) => setImmediate(resolve));
		(first === "filtered list" ? resolveDetail : resolveFiltered)();
		await new Promise<void>((resolve) => setImmediate(resolve));
		const result = view.getSnapshot();
		assert.equal(result.confirmed.complete, true);
		assert.equal(result.unresolved.length, 0);
		assert.deepEqual(
			result.rows.map((row) => row.data.name),
			["zz-description", "zzz-needle"],
		);
		assert.equal(
			selected.getSnapshot().rows[0]?.data.description,
			"Other services",
		);
	});
}

for (const change of [
	"omitted match",
	"unknown predicate",
	"absent member",
] as const) {
	test(`a late filtered reply preserves uncertainty about a newer ${change}`, async (t) => {
		const started = deferred<void>();
		const response = deferred<ObservationBatch>();
		const runtime = createRuntime({
			resources: [
				{
					name: "projects",
					sources: [
						{
							key: "filtered",
							mode: "list",
							fields: ["name"],
							membership: true,
							filters: capabilities,
							async run() {
								started.resolve();
								return response.promise;
							},
						},
					],
				},
			],
		});
		t.after(() => runtime.close());
		runtime.observe(batch([{ name: "Alpha" }]));
		const view = runtime.watch(names());
		const stop = view.subscribe(() => undefined);
		t.after(() => view.dispose());
		await started.promise;
		stop();
		runtime.observe({
			facts: [
				{
					resource: "projects",
					identity: "Alpha",
					basis: ["public"],
					presence: change === "absent member" ? "absent" : "present",
					values:
						change === "omitted match"
							? { name: "Alpha", description: "needle" }
							: { name: change === "unknown predicate" ? "Beta" : "Alpha" },
				},
			],
		});
		response.resolve(
			batch(change === "omitted match" ? [] : [{ name: "Alpha" }], search),
		);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(
			runtime
				.readModelSnapshot()
				.memberships.find((membership) => isFilterExpression(membership.where))
				?.complete,
			false,
		);
		if (change === "absent member")
			assert.equal(view.getSnapshot().rows.length, 0);
	});
}
