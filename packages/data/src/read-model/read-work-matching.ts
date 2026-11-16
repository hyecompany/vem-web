// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { filterFields, isFilterExpression } from "../filters.js";
import type { KnownRecord, QueryDescriptor } from "../types.js";
import { equal } from "../values.js";
import type { QueryMatching } from "./query-matching.js";
import type { QueryRequirements } from "./query-requirements.js";
import type { QueryKnowledge } from "./query-types.js";
import type { MissingRequirement } from "./requirements.js";

/** Match demanded evidence using the same identity, access, scope, and predicate rules as rows. */
export function matchesReadWork(
	host: QueryKnowledge,
	matching: QueryMatching,
	acquisition: QueryRequirements,
	query: QueryDescriptor,
	requirement: MissingRequirement,
): boolean {
	if (query.resource !== requirement.resource || !acquisition.allowed(query))
		return false;
	const definition = host.definition(query.resource);
	const fields = new Set([
		...query.select,
		...filterFields(query.where),
		...(query.orderBy ?? []).map((order) => order.field),
		...(definition.queryDependencies?.(query) ?? []),
	]);
	if (
		requirement.field &&
		(!fields.has(requirement.field) ||
			matching.fieldAccess(query, requirement.identity, requirement.field) ===
				"denied")
	)
		return false;
	if (
		[
			...filterFields(query.where),
			...(definition.queryDependencies?.(query) ?? []),
		].some(
			(field) =>
				matching.fieldAccess(query, requirement.identity, field) === "denied",
		)
	)
		return false;
	const collection =
		requirement.kind === "membership" ||
		requirement.kind === "collection-field";
	if (!collection) {
		const key = host.recordKey(query.resource, requirement.identity);
		if (
			query.mode === "one" &&
			key !== host.recordKey(query.resource, query.identity)
		)
			return false;
		const record = readWorkRecord(
			host,
			query.resource,
			requirement.identity,
		) ?? {
			key,
			resource: query.resource,
			identity: requirement.identity,
			values: {},
			fields: {},
			presence: "unknown" as const,
		};
		const result = matching.match(query, record);
		if (result === false) return false;
		if (result === "unknown" && !equal(query.scope, requirement.scope)) {
			const readable = matching.readable(query, record);
			if (
				definition.inScope?.(record.identity, query.scope, readable.values) !==
				true
			)
				return false;
		}
		return true;
	}
	if (!equal(query.scope, requirement.scope)) return false;
	if (query.mode === "one") {
		const record = readWorkRecord(host, query.resource, query.identity);
		return (
			!record ||
			matching.match({ ...requirement.query, select: query.select }, record) !==
				false
		);
	}
	if (
		definition.matches ||
		isFilterExpression(query.where) ||
		isFilterExpression(requirement.where)
	)
		return (
			matching.coversFilter(query, requirement.where) ||
			matching.coversFilter(requirement.query, query.where)
		);
	return Object.entries(query.where ?? {}).every(
		([field, value]) =>
			!Object.hasOwn(requirement.where ?? {}, field) ||
			equal(requirement.where?.[field], value),
	);
}

function readWorkRecord(
	host: QueryKnowledge,
	resource: string,
	identity: unknown,
): KnownRecord | undefined {
	const record = host.records.get(host.recordKey(resource, identity));
	if (
		!record ||
		!host.cells.get(host.factKey({ resource, identity, field: "$presence" }))
			?.stale
	)
		return record;
	return { ...record, presence: "unknown" };
}
