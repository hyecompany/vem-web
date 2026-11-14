// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "@hyecompany/vem-data";
import {
	createRuntime,
	DexiePersistence,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { deferred, MemoryPersistence } from "@hyecompany/vem-data/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

for (const backend of ["memory", "dexie"] as const) {
	test(`${backend}: restart costs reuse permitted same-caller inventory without expiring it`, async (t) => {
		for (const scenario of [
			"small",
			"large",
			"discovering",
			"other-caller",
			"revoked",
			"partial",
			"partial-survives",
			"other-scope",
			"other-filter",
		] as const) {
			await t.test(scenario, async (t) => {
				const memory = new MemoryPersistence();
				const database = `restart-cost-${crypto.randomUUID()}`;
				const storage = () =>
					backend === "memory"
						? memory
						: new DexiePersistence(database, { indexedDB, IDBKeyRange });
				const ids = Array.from(
					{ length: scenario === "large" ? 500 : 5 },
					(_, n) => String(n),
				);
				const scope = { tenant: "one" };
				const record = (identity: string, basis: string, label: string) => ({
					resource: "tasks",
					identity,
					values: { notes: `${label} ${identity}` },
					presence: "present" as const,
					basis: [basis],
					liveness: "snapshot" as const,
				});
				const first = createRuntime({
					contextId: "alice",
					access: [{ scope: "inventory", state: "allowed" }],
					persistence: storage(),
					resources: [{ name: "tasks", persist: () => true }],
				});
				await first.ready;
				first.observe({
					facts: ids.map((id) => record(id, "inventory", "Saved")),
					memberships: [
						{
							resource: "tasks",
							scope,
							where:
								scenario === "other-filter" ? { status: "open" } : undefined,
							identities: ids,
							complete: scenario !== "partial",
							basis: ["inventory"],
						},
					],
				});
				if (scenario === "partial-survives")
					first.observe({
						memberships: [
							{
								resource: "tasks",
								scope,
								identities: ids,
								complete: false,
								basis: ["public"],
							},
						],
					});
				if (scenario === "revoked" || scenario === "partial-survives")
					first.revoke("inventory");
				await first.flush();
				first.close();

				const calls: string[] = [];
				const started = deferred<void>();
				const gate = deferred<void>();
				const response = async (source: string, identity?: string) => {
					calls.push(source);
					started.resolve();
					await gate.promise;
					return {
						grants: [{ scope: "fresh", state: "allowed" as const }],
						facts: (identity === undefined ? ids : [identity]).map((id) => ({
							...record(id, "fresh", "Current"),
							...(source === "names" ? { values: {} } : {}),
						})),
						...(identity === undefined
							? {
									memberships: [
										{
											resource: "tasks",
											scope:
												scenario === "other-scope" ? { tenant: "two" } : scope,
											identities: ids,
											complete: true,
											basis: ["fresh"],
										},
									],
								}
							: {}),
					};
				};
				const definition: ResourceDefinition = {
					name: "tasks",
					persist: () => true,
					sources: [
						{
							key: "names",
							mode: "list",
							fields: [],
							membership: true,
							run: () => response("names"),
						},
						{
							key: "collection",
							mode: "list",
							fields: ["notes"],
							membership: true,
							run: () => response("collection"),
						},
						{
							key: "detail",
							mode: "one",
							fields: ["notes"],
							run: (request) =>
								response(
									`detail:${request.identity}`,
									String(request.identity),
								),
						},
					],
				};
				const runtime = createRuntime({
					contextId:
						scenario === "discovering"
							? "discovering"
							: scenario === "other-caller"
								? "bob"
								: "alice",
					resources: [definition],
					persistence: storage(),
				});
				t.after(() => {
					gate.resolve();
					runtime.close();
				});
				await runtime.ready;
				const queryScope =
					scenario === "other-scope" ? { tenant: "two" } : scope;
				const list = query({
					resource: "tasks",
					mode: "list",
					scope: queryScope,
					select: [],
				});
				const view = runtime.watch(list);
				t.after(() => view.dispose());
				const before = view.getSnapshot();
				const reads = Promise.all([
					runtime.read(list),
					...["0", "1", "2", "3", "4"].map((identity) =>
						runtime.read(
							query({
								resource: "tasks",
								mode: "one",
								identity,
								scope: queryScope,
								select: ["notes"],
							}),
						),
					),
				]);
				await started.promise;
				if (scenario === "small") {
					assert.deepEqual(calls, ["collection"]);
					assert.equal(before.rows.length, 5);
					assert.equal(before.confirmed.knownCount, 5);
					assert.equal(before.confirmed.complete, false);
					assert.equal(runtime.membership("tasks", scope)?.complete, false);
					assert.equal(view.getSnapshot().rows.length, 5);
				}
				if (
					[
						"discovering",
						"other-caller",
						"revoked",
						"partial-survives",
					].includes(scenario)
				)
					for (const record of runtime.readModelSnapshot().records)
						assert.equal(record.confirmed?.values.notes, undefined);
				else
					assert.equal(
						runtime.peekQuery(
							query({
								resource: "tasks",
								mode: "one",
								identity: "0",
								scope: queryScope,
								select: ["notes"],
							}),
						)?.rows[0]?.data.notes,
						"Saved 0",
					);
				gate.resolve();
				const results = await reads;
				assert.ok(
					results
						.slice(1)
						.every(
							(result, index) =>
								result.rows[0]?.data.notes === `Current ${index}`,
						),
				);
				assert.deepEqual(
					calls.sort(),
					scenario === "small"
						? ["collection"]
						: [
								"detail:0",
								"detail:1",
								"detail:2",
								"detail:3",
								"detail:4",
								"names",
							].sort(),
				);
			});
		}
	});
}
