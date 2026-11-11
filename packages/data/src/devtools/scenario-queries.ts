// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { TestClient } from "../testing/types.js";
import type { QueryDescriptor, Values } from "../types.js";
import type { QueryScenario, ResourceScenarios } from "./types.js";

export function scenarioQueries(
	test: TestClient,
	resources: ReadonlyMap<string, ResourceScenarios>,
) {
	const descriptors = new Map<string, QueryDescriptor>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const samples = new Map<
		string,
		{ rows?: QueryScenario["rows"]; data?: Values }
	>();
	const set = (id: string, scenario: QueryScenario) => {
		if (
			scenario.delayMs !== undefined &&
			(!Number.isFinite(scenario.delayMs) ||
				scenario.delayMs < 0 ||
				scenario.delayMs > 60_000)
		)
			throw new RangeError(
				"Scenario delay must be between 0 and 60000 milliseconds",
			);
		const query = descriptors.get(id);
		if (!query)
			throw new Error(
				"Use this query in a consumer before configuring its scenario",
			);
		const resource = resources.get(query.resource);
		if (!resource)
			throw new Error(`No scenario resource catalog for ${query.resource}`);
		for (const field of [
			...Object.keys(scenario.values ?? {}),
			...(scenario.missing ?? []),
			...(scenario.rows ?? []).flatMap((row) => Object.keys(row.data)),
		]) {
			if (!resource.fields.includes(field))
				throw new TypeError(
					`Unknown ${resource.name} scenario field: ${field}`,
				);
		}
		clearTimeout(timers.get(id));
		timers.delete(id);
		const seed = resource.example;
		const sample = {
			...samples.get(id),
			...(scenario.rows ? { rows: scenario.rows } : {}),
			...(scenario.values
				? { data: { ...samples.get(id)?.data, ...scenario.values } }
				: {}),
		};
		samples.set(id, sample);
		const source =
			sample.rows ??
			(seed
				? [
						{
							identity: query.mode === "one" ? query.identity : seed.identity,
							data: seed.data as Values,
						},
					]
				: []);
		const rowScope = (row: { identity: unknown; data: Values }) =>
			resource.inScope?.(row.identity, query.scope, row.data) ??
			(query.scope === undefined ? true : "unknown");
		const rows = ["empty", "loading", "denied"].includes(scenario.state)
			? []
			: source
					.map((row) => {
						const data = structuredClone({ ...row.data, ...sample.data });
						if (scenario.state === "partial")
							for (const field of scenario.missing ?? query.select.slice(-1))
								delete data[field];
						return { identity: row.identity, data };
					})
					.filter((row) => rowScope(row) !== false);
		const isUnresolved = (row: (typeof rows)[number]) =>
			rowScope(row) === "unknown" ||
			Object.keys(query.where ?? {}).some(
				(field) => !Object.hasOwn(row.data, field),
			);
		const unknownScope = rows.some((row) => rowScope(row) === "unknown");
		// An explicit loading scenario starts without this query's previous disclosure basis.
		if (scenario.state === "loading")
			test.setQuery({ query, status: "denied" });
		test.setQuery({
			query,
			rows: rows.filter((row) => !isUnresolved(row)),
			unresolved: rows.filter(isUnresolved),
			complete:
				scenario.state === "empty" ||
				(scenario.state === "ready" &&
					Boolean(seed || sample.rows) &&
					!unknownScope),
			exists:
				scenario.state === "empty" && query.mode === "one" ? false : undefined,
			status:
				scenario.state === "partial" || scenario.state === "empty"
					? "ready"
					: unknownScope && scenario.state === "ready"
						? "failed"
						: scenario.state,
			error: unknownScope
				? "Scenario scope is not established; supply an inScope definition or the fields it needs"
				: (scenario.message ?? "Simulated acquisition failure"),
			replace: resource.fields,
		});
		if (scenario.delayMs !== undefined) {
			timers.set(
				id,
				setTimeout(() => {
					timers.delete(id);
					set(id, { state: "ready" });
				}, scenario.delayMs),
			);
		}
	};
	return {
		ensure(query: QueryDescriptor) {
			const id = stableKey(query);
			if (!descriptors.has(id)) {
				descriptors.set(id, query);
				set(id, { state: "ready" });
			}
		},
		set,
		close() {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
			descriptors.clear();
			samples.clear();
		},
	};
}
