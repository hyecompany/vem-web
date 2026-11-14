// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { filterFields } from "../filters.js";
import type { FactRef, KnownRecord, Values } from "../types.js";
import { equal } from "../values.js";
import type { MissingRequirement } from "./requirements.js";
import type { ReadModelFact, ReadModelMembership } from "./types.js";

interface Evidence {
	recordKey(resource: string, identity: unknown): string;
	factKey(ref: FactRef): string;
	records: ReadonlyMap<string, KnownRecord>;
	cells: ReadonlyMap<string, ReadModelFact>;
	invalidations: ReadonlyMap<string, number>;
	memberships(): readonly ReadModelMembership[];
}
/** Only still-required, permitted evidence can make the result stale; absence alone is missing information. */
export function staleRequirement(
	requirement: MissingRequirement,
	evidence: Evidence,
	coversFilter: (where: Readonly<Values> | undefined) => boolean,
): boolean {
	if (requirement.kind === "membership")
		return evidence
			.memberships()
			.some(
				(membership) =>
					membership.stale === true &&
					membership.resource === requirement.resource &&
					equal(membership.scope, requirement.scope) &&
					coversFilter(membership.where),
			);
	if (requirement.kind === "collection-field") return false;
	const record = evidence.records.get(
		evidence.recordKey(requirement.resource, requirement.identity),
	);
	if (!record) return false;
	if (
		requirement.predicate &&
		evidence.memberships().some(
			(membership) =>
				membership.resource === requirement.resource &&
				equal(membership.scope, requirement.scope) &&
				equal(membership.where ?? {}, requirement.where ?? {}) &&
				membership.identities.some(
					(identity) =>
						evidence.recordKey(membership.resource, identity) === record.key,
				) &&
				(membership.stale ||
					filterFields(requirement.where).some((field) => {
						const key = evidence.factKey({
							resource: requirement.resource,
							identity: requirement.identity,
							field,
						});
						return (
							Math.max(
								evidence.cells.get(key)?.revision ?? 0,
								evidence.invalidations.get(key) ?? 0,
							) > membership.revision
						);
					})),
		)
	)
		return true;
	if (requirement.kind === "presence")
		return (
			evidence.cells.get(
				evidence.factKey({
					resource: requirement.resource,
					identity: requirement.identity,
					field: "$presence",
				}),
			)?.stale === true
		);
	return (
		requirement.field !== undefined &&
		record.fields[requirement.field]?.stale === true
	);
}
