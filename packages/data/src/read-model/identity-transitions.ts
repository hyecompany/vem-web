// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { IdentityTransition, KnownRecord } from "../types.js";

/** Resolve only explicit, unbroken incarnation links whose destination is still known. */
export function detailIdentityTransitions(
	resource: string,
	identity: unknown,
	transitions: readonly IdentityTransition[],
	recordKey: (resource: string, identity: unknown) => string,
	records: ReadonlyMap<string, KnownRecord>,
): readonly IdentityTransition[] | undefined {
	const key = recordKey(resource, identity);
	const links = new Map(
		transitions.map((entry) => [entry.from.incarnation, entry]),
	);
	const result: IdentityTransition[] = [];
	for (const entry of transitions) {
		if (
			entry.resource !== resource ||
			recordKey(resource, entry.from.identity) !== key
		)
			continue;
		let terminal = entry;
		const visited = new Set([entry.from.incarnation]);
		while (
			links.has(terminal.to.incarnation) &&
			!visited.has(terminal.to.incarnation)
		) {
			visited.add(terminal.to.incarnation);
			terminal = links.get(terminal.to.incarnation) as IdentityTransition;
		}
		const destination = records.get(recordKey(resource, terminal.to.identity));
		if (
			visited.has(terminal.to.incarnation) ||
			destination?.incarnation !== terminal.to.incarnation
		)
			continue;
		result.push({ resource, from: entry.from, to: terminal.to });
	}
	return result.length ? result : undefined;
}
