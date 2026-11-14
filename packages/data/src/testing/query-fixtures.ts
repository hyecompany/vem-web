// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { filterFields, matchesFilter } from "../filters.js";
import type { QueryDescriptor, Values } from "../types.js";
import { equal } from "../values.js";
import type { QueryFixtureInput, TestClientOptions } from "./types.js";

export function fixtureRows(fixture: QueryFixtureInput | undefined) {
	return [...(fixture?.rows ?? []), ...(fixture?.unresolved ?? [])];
}

/** Every simulated representation reads the same latest values for a resource identity. */
export function reconcileQueryFixtures(
	fixtures: Map<string, QueryFixtureInput>,
	candidates: Map<string, ReturnType<typeof fixtureRows>>,
	incoming: QueryFixtureInput,
	inScope: NonNullable<TestClientOptions["scopes"]>[string] | undefined,
): QueryDescriptor[] {
	const updates = new Map(
		fixtureRows(incoming).map((row) => [stableKey(row.identity), row.data]),
	);
	const absent =
		incoming.query.mode === "one" && incoming.exists === false
			? stableKey(incoming.query.identity)
			: undefined;
	const affected: QueryDescriptor[] = [];
	for (const [key, fixture] of fixtures) {
		if (
			key === stableKey(incoming.query) ||
			fixture.query.resource !== incoming.query.resource
		)
			continue;
		let changed = false;
		const nextCandidates: ReturnType<typeof fixtureRows> = [];
		const rows: NonNullable<QueryFixtureInput["rows"]>[number][] = [];
		const unresolved: NonNullable<QueryFixtureInput["unresolved"]>[number][] =
			[];
		for (const row of candidates.get(key) ?? fixtureRows(fixture)) {
			if (stableKey(row.identity) === absent) {
				changed = true;
				continue;
			}
			const replacement = updates.get(stableKey(row.identity));
			if (!replacement) {
				nextCandidates.push(row);
				if (fixture.unresolved?.includes(row)) unresolved.push(row);
				else if (fixture.rows?.includes(row)) rows.push(row);
				continue;
			}
			const data: Values = { ...row.data };
			for (const field of incoming.replace ?? []) delete data[field];
			Object.assign(data, replacement);
			if (!equal(row.data, data)) changed = true;
			const updated = { identity: row.identity, data };
			nextCandidates.push(updated);
			const scope = inScope?.(row.identity, fixture.query.scope, data) ?? true;
			const match = matchesFilter(data, fixture.query.where);
			if (scope === false || match === false) continue;
			const uncertain = scope === "unknown" || match === "unknown";
			(uncertain ? unresolved : rows).push(updated);
		}
		if (!changed) continue;
		candidates.set(key, nextCandidates);
		const predicateChanged = filterFields(fixture.query.where).length > 0;
		fixtures.set(key, {
			...fixture,
			rows,
			unresolved,
			complete:
				predicateChanged || unresolved.length > 0 ? false : fixture.complete,
		});
		affected.push(fixture.query);
	}
	return affected;
}
