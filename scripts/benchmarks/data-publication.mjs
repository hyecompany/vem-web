// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// Run: node --import tsx scripts/benchmarks/data-publication.mjs [rows...]
// Measures synchronous CPU work, excluding network, worker cloning, DOM and React.

import assert from "node:assert/strict";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { BrowserQueries } from "../../packages/data/src/client-queries.ts";
import { query } from "../../packages/data/src/descriptors.ts";
import { createRuntime } from "../../packages/data/src/runtime.ts";

const sizes =
	process.argv.length > 2
		? process.argv.slice(2).map(Number)
		: [100, 1000, 5000];
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 12))
	throw new Error("Row counts must be integers of at least 12");
const summary = (samples) => {
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
		p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2)),
	};
};
const measure = (work) => {
	const start = performance.now();
	work();
	return performance.now() - start;
};
console.log(
	JSON.stringify({
		node: process.version,
		cpu: cpus()[0]?.model,
		warmups: 2,
		samples: 7,
		retainedQueries: 12,
	}),
);
for (const count of sizes) {
	const definition = { name: "instances", access: () => "read" };
	const runtime = createRuntime({
		resources: [definition],
		contextId: "benchmark",
		access: [{ scope: "read", state: "allowed" }],
		maxInactiveRecords: count,
	});
	const tabs = [];
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
		assert.equal(runtime.readModelSnapshot().records.length, count);
		for (const activeQueries of [12, 6, 1]) {
			const client = new BrowserQueries(
				[definition],
				{
					send() {},
					retry() {
						throw new Error("Benchmark does not acquire data");
					},
				},
				12,
			);
			const apply = () =>
				client.apply(
					runtime.readModelSnapshot(),
					runtime.accessSnapshot(),
					[],
					[],
					false,
					false,
				);
			apply();
			const handles = [];
			for (let index = 0; index < 12; index++) {
				const handle = client.watch(
					query({
						resource: "instances",
						mode: "list",
						select:
							index < 6
								? ["name", "status"]
								: ["name", "status", "description"],
						where: { location: `node-${index % 8}` },
					}),
				);
				const unsubscribe = handle.subscribe(() => {});
				if (index >= activeQueries) unsubscribe();
				handles.push(handle);
			}
			tabs.push({ activeQueries, handles, apply, times: [] });
		}
		const ownerTimes = [];
		for (let sample = 0; sample < 9; sample++) {
			const owner = measure(() =>
				runtime.observe({
					facts: [
						{
							...facts[sample],
							values: { status: sample % 2 ? "Stopped" : "Running" },
						},
					],
				}),
			);
			if (sample >= 2) ownerTimes.push(owner);
			for (const tab of tabs) {
				const duration = measure(tab.apply);
				if (sample >= 2) tab.times.push(duration);
			}
		}
		console.log(
			JSON.stringify({
				rows: count,
				ownerPublication: summary(ownerTimes),
				tabPublications: tabs.map((tab) => ({
					activeQueries: tab.activeQueries,
					...summary(tab.times),
				})),
			}),
		);
	} finally {
		for (const tab of tabs) for (const handle of tab.handles) handle.dispose();
		runtime.close();
	}
}
