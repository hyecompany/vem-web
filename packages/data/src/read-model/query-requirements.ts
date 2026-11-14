// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { filterFields, isFilterExpression } from "../filters.js";
import type { QueryDescriptor } from "../types.js";
import { equal } from "../values.js";
import { evaluateAccess, readAccess } from "./access-requirements.js";
import type { QueryMatching } from "./query-matching.js";
import type { QueryKnowledge } from "./query-types.js";
import { staleRequirement } from "./requirement-currency.js";
import type { MissingRequirement } from "./requirements.js";

export class QueryRequirements {
	constructor(
		private readonly host: QueryKnowledge,
		private readonly matching: QueryMatching,
	) {}
	allowed(descriptor: QueryDescriptor): boolean {
		return (
			evaluateAccess(
				readAccess(this.host.definition(descriptor.resource), descriptor),
				(scope) => this.host.access(scope),
			) !== "denied"
		);
	}
	private shape(descriptor: QueryDescriptor, forcedFields: readonly string[]) {
		const definition = this.host.definition(descriptor.resource);
		return {
			definition,
			base: {
				resource: descriptor.resource,
				scope: descriptor.scope,
				where: descriptor.where,
				query: descriptor,
			},
			fields: [
				...new Set([
					...descriptor.select,
					...filterFields(descriptor.where),
					...(descriptor.orderBy ?? []).map((order) => order.field),
					...(definition.queryDependencies?.(descriptor) ?? []),
					...forcedFields,
				]),
			],
			selectedField: (field: string) =>
				descriptor.select.includes(field) ||
				(descriptor.orderBy ?? []).some((order) => order.field === field) ||
				forcedFields.includes(field),
			filterField: (field: string) =>
				filterFields(descriptor.where).includes(field),
		};
	}
	collection(
		descriptor: QueryDescriptor,
		forcedFields: readonly string[],
		identities: number,
	): MissingRequirement[] {
		if (!this.allowed(descriptor) || descriptor.mode === "one") return [];
		const { base, fields, selectedField, filterField } = this.shape(
			descriptor,
			forcedFields,
		);
		const requirements: MissingRequirement[] = [];
		const coverage = this.matching.coverage(descriptor);
		if (!coverage) {
			requirements.push({ ...base, kind: "membership" });
			for (const field of fields) {
				if (
					this.matching.fieldAccess(descriptor, undefined, field) === "denied"
				)
					continue;
				requirements.push({
					...base,
					kind: "collection-field",
					field,
					...(filterField(field) && !selectedField(field)
						? { predicate: true }
						: {}),
				});
				if (filterField(field) && selectedField(field))
					requirements.push({
						...base,
						kind: "collection-field",
						field,
						predicate: true,
					});
			}
		} else if (identities === 0 && forcedFields.length > 0) {
			requirements.push({ ...base, kind: "membership" });
		}
		return this.current(requirements);
	}
	record(
		descriptor: QueryDescriptor,
		key: string,
		identity: unknown,
		forcedFields: readonly string[],
		match: boolean | "unknown" | undefined,
	): MissingRequirement[] {
		if (!this.allowed(descriptor)) return [];
		const { definition, base, fields, selectedField, filterField } = this.shape(
			descriptor,
			forcedFields,
		);
		const requirements: MissingRequirement[] = [];
		const original = this.host.records.get(key);
		const record = original && this.matching.readable(descriptor, original);
		const unresolved = descriptor.mode === "list" && match === "unknown";
		const dependencies = definition.queryDependencies?.(descriptor) ?? [];
		const presence = this.host.cells.get(
			this.host.factKey({
				resource: descriptor.resource,
				identity,
				field: "$presence",
			}),
		);
		if (record?.presence === "absent" && !presence?.stale) return [];
		if (!record || record.presence === "unknown" || presence?.stale)
			requirements.push({ ...base, kind: "presence", identity });
		for (const field of fields) {
			if (this.matching.fieldAccess(descriptor, identity, field) === "denied")
				continue;
			const needsValue =
				!unresolved ||
				dependencies.includes(field) ||
				forcedFields.includes(field);
			if (!needsValue && !filterField(field)) continue;
			const info = record?.fields[field];
			const selected =
				needsValue &&
				(descriptor.select.includes(field) ||
					(descriptor.orderBy ?? []).some((order) => order.field === field));
			const selectedValue = needsValue && selectedField(field);
			const provenFilter =
				record &&
				filterField(field) &&
				(isFilterExpression(descriptor.where)
					? (match ?? this.matching.match(descriptor, record)) !== "unknown"
					: this.matching.membershipField(
							descriptor,
							record,
							field,
							descriptor.where?.[field],
						));
			const scopeDescriptor = { ...descriptor, where: undefined };
			const provenScope =
				!selected &&
				!filterField(field) &&
				record &&
				(definition.queryDependencies?.(scopeDescriptor) ?? []).includes(
					field,
				) &&
				this.matching.membershipScope(scopeDescriptor, record);
			if (
				forcedFields.includes(field) ||
				((!info || info.stale) && (!provenFilter || selected) && !provenScope)
			) {
				requirements.push({
					...base,
					kind: "field",
					identity,
					field,
					...(filterField(field) && !selectedValue ? { predicate: true } : {}),
				});
			}
			if (
				filterField(field) &&
				selectedValue &&
				!provenFilter &&
				(!info || info.stale)
			)
				requirements.push({
					...base,
					kind: "field",
					identity,
					field,
					predicate: true,
				});
		}
		return this.current(requirements);
	}
	private current(requirements: MissingRequirement[]): MissingRequirement[] {
		return requirements.map((requirement) => ({
			...requirement,
			generation: this.requirementGeneration(requirement),
			...(staleRequirement(requirement, this.host, (where) =>
				this.matching.coversFilter(requirement.query, where),
			)
				? { stale: true }
				: {}),
		}));
	}
	private requirementGeneration(requirement: MissingRequirement): number {
		if (
			requirement.kind === "membership" ||
			requirement.kind === "collection-field"
		) {
			const prefix = `membership:${requirement.resource}:${stableKey(requirement.scope)}:`;
			let generation = Math.max(
				this.host.invalidations.get(
					`${prefix}${stableKey(requirement.where ?? {})}`,
				) ?? 0,
				this.host.invalidations.get(`${prefix}${stableKey({})}`) ?? 0,
			);
			for (const membership of this.host.memberships())
				if (
					membership.resource === requirement.resource &&
					equal(membership.scope, requirement.scope) &&
					this.matching.coversFilter(requirement.query, membership.where)
				)
					generation = Math.max(
						generation,
						membership.currencyRevision ?? 0,
						this.host.invalidations.get(`membership:${membership.key}`) ?? 0,
					);
			return generation;
		}
		const key = this.host.factKey({
			resource: requirement.resource,
			identity: requirement.identity,
			field:
				requirement.kind === "presence"
					? "$presence"
					: (requirement.field ?? ""),
		});
		const cell = this.host.cells.get(key);
		return Math.max(
			this.host.invalidations.get(key) ?? 0,
			cell?.stale ? (cell.currencyRevision ?? cell.revision) : 0,
		);
	}
}
