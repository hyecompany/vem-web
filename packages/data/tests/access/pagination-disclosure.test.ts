// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { MemoryPersistence } from "@hyecompany/vem-data/testing";

test("paginated membership combines page proofs without losing independent row disclosure", {
	timeout: 5000,
}, async (t) => {
	const persistence = new MemoryPersistence();
	let reads = 0;
	const runtime = createRuntime({
		persistence,
		access: ["page-a", "alternative-a", "page-b"].map((scope) => ({
			scope,
			state: "allowed" as const,
		})),
		resources: [
			{
				name: "tasks",
				persist: () => true,
				sources: [
					{
						key: "pages",
						mode: "list",
						fields: [],
						membership: true,
						pagination: { pageSize: 1 },
						async run(request) {
							reads++;
							const last = request.page?.cursor === "second";
							return {
								batch: {
									memberships: [
										{
											resource: "tasks",
											identities: [last ? "b" : "a"],
											complete: last,
											basis: last ? ["page-b"] : ["page-a", "alternative-a"],
										},
									],
								},
								next: last ? undefined : "second",
							};
						},
					},
				],
			},
		],
	});
	t.after(() => runtime.close());
	const descriptor = query({ resource: "tasks", mode: "list", select: [] });
	const complete = await runtime.read(descriptor);
	assert.equal(complete.confirmed.total, 2);
	assert.deepEqual(runtime.membership("tasks")?.identities, ["a", "b"]);
	assert.equal(reads, 2);
	runtime.setAccess({ decisions: [{ scope: "page-a", state: "denied" }] });
	const handle = runtime.watch(descriptor);
	t.after(() => handle.dispose());
	assert.equal(handle.getSnapshot().confirmed.complete, true);
	runtime.setAccess({
		decisions: [{ scope: "alternative-a", state: "denied" }],
	});
	assert.equal(handle.getSnapshot().confirmed.complete, false);
	assert.deepEqual(
		handle.getSnapshot().rows.map((row) => row.identity),
		[{ kind: "resource", resource: "b" }],
	);
	await runtime.flush();
	assert.equal(persistence.memberships.size, 0);
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.identity === "a"),
		false,
	);
	assert.equal(
		[...persistence.facts.values()].some((fact) => fact.identity === "b"),
		true,
	);
	runtime.setAccess({ decisions: [{ scope: "page-a", state: "allowed" }] });
	assert.deepEqual(
		handle.getSnapshot().rows.map((row) => row.identity),
		[{ kind: "resource", resource: "b" }],
	);
	assert.equal(reads, 2);
});
