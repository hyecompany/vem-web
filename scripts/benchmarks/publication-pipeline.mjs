// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// Run: node --import tsx scripts/benchmarks/publication-pipeline.mjs [rows...]
// Measures summed CPU across simulated contexts, not browser latency or React rendering.

import assert from "node:assert/strict";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const source =
	process.env.VEM_BENCH_SOURCE_ROOT ??
	fileURLToPath(new URL("../../packages/data/src/", import.meta.url));
const module = (name) => import(pathToFileURL(resolve(source, name)).href);
const { BrowserQueries } = await module("client-queries.ts");
const { query } = await module("descriptors.ts");
const { createRuntime } = await module("runtime.ts");
const { applyReadModel, emptyReadModel, readModelDelta } = await module(
	"read-model/publication.ts",
);
const sizes =
	process.argv.length > 2
		? process.argv.slice(2).map(Number)
		: [100, 1000, 5000];
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 16))
	throw new Error("Row counts must be integers of at least 16");
const warmups = 2;
const samples = 7;
const summary = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
		p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2),
	};
};
const measure = (work) => {
	const start = performance.now();
	const value = work();
	return { value, elapsed: performance.now() - start };
};
const cases = [
	{
		name: "selected-field",
		values: (index) => ({ status: index % 2 ? "Stopped" : "Running" }),
	},
	{
		name: "filter-movement",
		values: (index) => ({ location: index % 2 ? "node-0" : "node-6" }),
	},
	{
		name: "unselected-field",
		values: (index) => ({ description: `Revision ${index}` }),
	},
];
console.log(
	JSON.stringify({
		node: process.version,
		cpu: cpus()[0]?.model,
		source,
		warmups,
		samples,
		activeQueriesPerTab: [12, 6, 1],
		retainedQueriesPerTab: 12,
		includes: [
			"active owner subscriptions",
			"delta creation",
			"structured clone",
			"replica application",
			"query projection",
			"listener reads",
		],
		excludes: [
			"actual Worker scheduling and postMessage",
			"network",
			"React",
			"DOM",
		],
	}),
);

for (const count of sizes)
	for (const scenario of cases) {
		const definition = { name: "instances", access: () => "read" };
		const runtime = createRuntime({
			resources: [definition],
			contextId: "benchmark",
			access: [{ scope: "read", state: "allowed" }],
			maxInactiveRecords: count,
		});
		const tabs = [];
		const totals = {
			ownerObserve: [],
			ownerPublications: [],
			structuredClone: [],
			summedCpu: [],
		};
		const row = {
			name: "Instance 0",
			status: "Stopped",
			description: "Description 0",
			location: "node-0",
		};
		try {
			await runtime.ready;
			const facts = Array.from({ length: count }, (_, index) => ({
				resource: "instances",
				identity: String(index),
				presence: "present",
				values: {
					name: `Instance ${index}`,
					status: index % 2 ? "Running" : "Stopped",
					description: `Description ${index}`,
					project: `project-${index % 4}`,
					type: index % 3 ? "container" : "virtual-machine",
					location: `node-${index % 8}`,
				},
				basis: ["read"],
			}));
			runtime.observe({
				facts,
				memberships: [
					{
						resource: "instances",
						identities: facts.map((fact) => fact.identity),
						complete: true,
						basis: ["read"],
					},
				],
			});
			for (const active of [12, 6, 1]) {
				const ownerHandles = new Map();
				const retained = [];
				let listenerReads = 0;
				const client = new BrowserQueries(
					[definition],
					{
						send(message) {
							if (message.type === "watch") {
								const handle = runtime.watch(message.query);
								const stop = handle.subscribe(() => {});
								ownerHandles.set(message.id, { handle, stop });
							} else if (
								message.type === "unwatch" ||
								message.type === "forget-query"
							) {
								const owned = ownerHandles.get(message.id);
								owned?.stop();
								owned?.handle.dispose();
								ownerHandles.delete(message.id);
							}
						},
						retry() {
							throw new Error("Benchmark must not acquire data");
						},
					},
					12,
				);
				const tab = {
					active,
					client,
					ownerHandles,
					retained,
					ownerModel: emptyReadModel(),
					model: emptyReadModel(),
					initial: true,
					replicaTimes: [],
					projectionTimes: [],
					notifications: [],
					listenerReads: () => listenerReads,
				};
				const initial = runtime.readModelSnapshot();
				tab.model = applyReadModel(
					tab.model,
					structuredClone(readModelDelta(tab.ownerModel, initial, true)),
					true,
				);
				client.apply(tab.model, runtime.accessSnapshot(), [], [], true, true);
				tab.ownerModel = initial;
				for (let index = 0; index < 12; index++) {
					const descriptor = query({
						resource: "instances",
						mode: "list",
						select:
							index < 6
								? ["name", "status"]
								: ["name", "status", "description"],
						where: { location: `node-${index % 8}` },
					});
					const handle = client.watch(descriptor);
					const stop = handle.subscribe(() => {
						listenerReads++;
						handle.getSnapshot();
					});
					if (index >= active) stop();
					retained.push({ descriptor, handle });
				}
				tabs.push(tab);
			}
			await new Promise((resolve) => setImmediate(resolve));
			const publish = (tab) => {
				const owner = measure(() => {
					const model = runtime.readModelSnapshot();
					const update = {
						readModel: readModelDelta(tab.ownerModel, model, tab.initial),
						access: runtime.accessSnapshot(),
						activities: runtime.listActivities(),
						queries: [...tab.ownerHandles].map(([id, { handle }]) => {
							const value = handle.getSnapshot();
							return {
								id,
								status: {
									settled: value.settled,
									fetching: value.fetching,
									revalidating: value.revalidating,
									issues: value.issues.filter(
										(issue) => issue.kind !== "access",
									),
								},
							};
						}),
					};
					tab.ownerModel = model;
					return update;
				});
				const cloned = measure(() => structuredClone(owner.value));
				const update = cloned.value;
				const replica = measure(() =>
					applyReadModel(tab.model, update.readModel, tab.initial),
				);
				tab.model = replica.value;
				const notificationsBefore = tab.listenerReads();
				const projection = measure(() => {
					const listeners = tab.client.apply(
						tab.model,
						update.access,
						update.activities,
						update.queries,
						tab.initial,
						tab.initial,
					);
					for (const notify of listeners) notify();
				});
				tab.initial = false;
				return {
					owner: owner.elapsed,
					clone: cloned.elapsed,
					replica: replica.elapsed,
					projection: projection.elapsed,
					notifications: tab.listenerReads() - notificationsBefore,
				};
			};
			for (const tab of tabs) publish(tab);
			for (let sample = 0; sample < warmups + samples; sample++) {
				const values = scenario.values(sample);
				Object.assign(row, values);
				const owner = measure(() =>
					runtime.observe({
						facts: [
							{
								resource: "instances",
								identity: "0",
								presence: "present",
								values,
								basis: ["read"],
							},
						],
					}),
				);
				let publicationTime = 0;
				let cloneTime = 0;
				let totalTime = owner.elapsed;
				for (const tab of tabs) {
					const stages = publish(tab);
					publicationTime += stages.owner;
					cloneTime += stages.clone;
					totalTime +=
						stages.owner + stages.clone + stages.replica + stages.projection;
					if (sample >= warmups) {
						tab.replicaTimes.push(stages.replica);
						tab.projectionTimes.push(stages.projection);
						tab.notifications.push(stages.notifications);
					}
					for (const { descriptor, handle } of tab.retained.slice(
						0,
						tab.active,
					)) {
						const result = handle.getSnapshot();
						assert.equal(result.confirmed.complete, true);
						assert.equal(result.unresolved.length, 0);
						assert.equal(result.fetching, false);
						const target = result.rows.find(
							(item) =>
								item.identity.kind === "resource" &&
								item.identity.resource === "0",
						);
						const matches = descriptor.where.location === row.location;
						assert.equal(Boolean(target), matches);
						if (target)
							for (const field of descriptor.select)
								assert.equal(target.data[field], row[field]);
					}
				}
				if (sample >= warmups) {
					totals.ownerObserve.push(owner.elapsed);
					totals.ownerPublications.push(publicationTime);
					totals.structuredClone.push(cloneTime);
					totals.summedCpu.push(totalTime);
				}
			}
			console.log(
				JSON.stringify({
					rows: count,
					scenario: scenario.name,
					...Object.fromEntries(
						Object.entries(totals).map(([name, times]) => [
							name,
							summary(times),
						]),
					),
					tabs: tabs.map((tab) => ({
						activeQueries: tab.active,
						replicaApplication: summary(tab.replicaTimes),
						projectionAndNotifications: summary(tab.projectionTimes),
						notifiedQueries: {
							min: Math.min(...tab.notifications),
							max: Math.max(...tab.notifications),
						},
					})),
				}),
			);
		} finally {
			for (const tab of tabs)
				for (const { handle } of tab.retained) handle.dispose();
			runtime.close();
		}
	}
