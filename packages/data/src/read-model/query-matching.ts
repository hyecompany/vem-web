// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	AccessState,
	FieldInfo,
	KnownRecord,
	QueryDescriptor,
	QueryRow,
	Values,
} from "../types.js";
import { equal, frozen } from "../values.js";
import { evaluateAccess, fieldAccess } from "./access-requirements.js";
import type { QueryKnowledge } from "./query-types.js";
import { filterCovers } from "./requirements.js";
import type {
	ReadModelEffectiveRecord as EffectiveRecord,
	ReadModelMembership,
} from "./types.js";

export class QueryMatching {
	private readonly membershipKeys = new WeakMap<
		ReadModelMembership,
		ReadonlySet<string>
	>();
	constructor(
		private readonly host: QueryKnowledge,
		private readonly onMembership?: (key: string) => void,
	) {}
	uses(membership: ReadModelMembership): true {
		this.onMembership?.(membership.key);
		return true;
	}
	members(membership: ReadModelMembership): ReadonlySet<string> {
		let keys = this.membershipKeys.get(membership);
		if (!keys) {
			keys = new Set(
				membership.identities.map((identity) =>
					this.host.recordKey(membership.resource, identity),
				),
			);
			this.membershipKeys.set(membership, keys);
		}
		return keys;
	}
	fieldAccess(
		descriptor: QueryDescriptor,
		identity: unknown,
		field: string,
	): AccessState {
		return evaluateAccess(
			fieldAccess(this.host.definition(descriptor.resource), field, identity),
			(scope) => this.host.access(scope),
		);
	}
	readable(descriptor: QueryDescriptor, record: KnownRecord): KnownRecord {
		const fields = Object.keys(record.fields).filter(
			(field) =>
				this.fieldAccess(descriptor, record.identity, field) !== "denied",
		);
		if (fields.length === Object.keys(record.fields).length) return record;
		return {
			...record,
			fields: Object.fromEntries(
				Object.entries(record.fields).filter(([field]) =>
					fields.includes(field),
				),
			),
			values: Object.fromEntries(
				fields.map((field) => [field, record.values[field]]),
			),
		};
	}
	coversFilter(
		descriptor: QueryDescriptor,
		where: Readonly<Values> | undefined,
	): boolean {
		if (this.host.definition(descriptor.resource).matches)
			return (
				Object.keys(where ?? {}).length === 0 ||
				equal(where ?? {}, descriptor.where ?? {})
			);
		return filterCovers(where, descriptor.where);
	}
	coverage(descriptor: QueryDescriptor): ReadModelMembership | undefined {
		return this.host
			.memberships()
			.find(
				(membership) =>
					membership.resource === descriptor.resource &&
					membership.complete &&
					equal(membership.scope, descriptor.scope) &&
					this.coversFilter(descriptor, membership.where),
			);
	}
	membershipField(
		descriptor: QueryDescriptor,
		record: KnownRecord,
		field: string,
		expected: unknown,
	): boolean {
		if (this.fieldAccess(descriptor, record.identity, field) === "denied")
			return false;
		return this.host
			.memberships()
			.some(
				(membership) =>
					membership.resource === descriptor.resource &&
					equal(membership.scope, descriptor.scope) &&
					Object.hasOwn(membership.where ?? {}, field) &&
					equal(membership.where?.[field], expected) &&
					this.members(membership).has(record.key) &&
					this.membershipCurrent(
						membership,
						{ ...descriptor, where: { [field]: expected } },
						record,
					) &&
					this.uses(membership),
			);
	}
	match(descriptor: QueryDescriptor, record: KnownRecord): boolean | "unknown" {
		const definition = this.host.definition(descriptor.resource);
		record = this.readable(descriptor, record);
		if (record.resource !== descriptor.resource || record.presence === "absent")
			return false;
		if (
			descriptor.mode === "one" &&
			this.host.recordKey(descriptor.resource, descriptor.identity) !==
				record.key
		)
			return false;
		const dependencies =
			definition.queryDependencies?.(descriptor) ??
			(definition.matches && Object.keys(descriptor.where ?? {}).length > 0
				? Object.keys(record.fields)
				: []);
		if (
			[...Object.keys(descriptor.where ?? {}), ...dependencies].some(
				(field) =>
					this.fieldAccess(descriptor, record.identity, field) === "denied",
			)
		)
			return "unknown";
		const scopeIdentity =
			record.identity ?? (record as EffectiveRecord).requested;
		let scopeFromMembership = false;
		const scopeDescriptor = { ...descriptor, where: undefined };
		if (descriptor.scope !== undefined && definition.inScope) {
			const scopedValues = Object.fromEntries(
				Object.entries(record.values).filter(
					([field]) => !record.fields[field]?.stale,
				),
			);
			const scope = definition.inScope(
				scopeIdentity,
				descriptor.scope,
				scopedValues,
			);
			if (scope === false) return false;
			if (scope === "unknown") {
				scopeFromMembership = this.membershipScope(scopeDescriptor, record);
				if (!scopeFromMembership)
					return this.membershipMatch(descriptor, record);
			}
		}
		if (
			descriptor.mode === "list" &&
			record.identity !== undefined &&
			this.excluded(descriptor, record)
		)
			return false;
		const establishedScopeFields = scopeFromMembership
			? (definition.queryDependencies?.(scopeDescriptor) ?? [])
			: [];
		if (
			definition.matches &&
			[
				...Object.keys(descriptor.where ?? {}),
				...dependencies.filter(
					(field) => !establishedScopeFields.includes(field),
				),
			].some((field) => record.fields[field]?.stale)
		)
			return this.membershipMatch(descriptor, record);
		if (!descriptor.where || Object.keys(descriptor.where).length === 0)
			return true;
		if (definition.matches) {
			const match = definition.matches(
				record.values,
				descriptor.where,
				descriptor.scope,
				scopeIdentity,
			);
			return match === "unknown"
				? this.membershipMatch(descriptor, record)
				: match;
		}
		let unknown = false;
		for (const [field, expected] of Object.entries(descriptor.where)) {
			if (!Object.hasOwn(record.values, field) || record.fields[field]?.stale) {
				if (!this.membershipField(descriptor, record, field, expected))
					unknown = true;
			} else if (!equal(record.values[field], expected)) return false;
		}
		return unknown ? this.membershipMatch(descriptor, record) : true;
	}

	membershipScope(descriptor: QueryDescriptor, record: KnownRecord): boolean {
		return this.host
			.memberships()
			.some(
				(membership) =>
					membership.resource === descriptor.resource &&
					equal(membership.scope, descriptor.scope) &&
					this.members(membership).has(record.key) &&
					this.membershipCurrent(membership, descriptor, record) &&
					this.uses(membership),
			);
	}

	excluded(descriptor: QueryDescriptor, record: KnownRecord): boolean {
		return this.host.memberships().some((membership) => {
			if (
				membership.resource !== descriptor.resource ||
				!membership.complete ||
				!equal(membership.scope, descriptor.scope)
			)
				return false;
			if (!this.coversFilter(descriptor, membership.where)) return false;
			if (this.members(membership).has(record.key)) return false;
			return (
				this.membershipCurrent(membership, descriptor, record) &&
				this.uses(membership)
			);
		});
	}

	membershipCurrent(
		membership: ReadModelMembership,
		descriptor: QueryDescriptor,
		record: KnownRecord,
	): boolean {
		const definition = this.host.definition(descriptor.resource);
		const dependencies = [
			"$presence",
			...Object.keys(descriptor.where ?? {}),
			...(definition.queryDependencies?.(descriptor) ??
				(definition.matches && Object.keys(descriptor.where ?? {}).length > 0
					? Object.keys(record.fields)
					: [])),
		];
		if (
			dependencies.some((field) => {
				const key = this.host.factKey({
					resource: descriptor.resource,
					identity: record.identity,
					field,
				});
				return (
					Math.max(
						this.host.cells.get(key)?.revision ?? 0,
						this.host.invalidations.get(key) ?? 0,
					) > membership.revision
				);
			})
		)
			return false;
		return !membership.stale;
	}

	membershipMatch(
		descriptor: QueryDescriptor,
		record: KnownRecord,
	): boolean | "unknown" {
		for (const membership of this.host.memberships()) {
			if (
				membership.resource !== descriptor.resource ||
				!equal(membership.scope, descriptor.scope) ||
				!equal(membership.where ?? {}, descriptor.where ?? {}) ||
				!this.membershipCurrent(membership, descriptor, record)
			)
				continue;
			if (this.members(membership).has(record.key))
				return this.uses(membership);
			const presence = this.host.cells.get(
				this.host.factKey({
					resource: descriptor.resource,
					identity: record.identity,
					field: "$presence",
				}),
			);
			if (
				membership.complete &&
				(presence?.revision ?? 0) <= membership.revision
			) {
				this.uses(membership);
				return false;
			}
		}
		return "unknown";
	}

	row(descriptor: QueryDescriptor, record: EffectiveRecord): QueryRow {
		const data: Values = {},
			fields: Record<string, FieldInfo> = {},
			missing: string[] = [];
		for (const field of descriptor.select) {
			const info =
				this.fieldAccess(descriptor, record.identity, field) === "denied"
					? undefined
					: record.fields[field];
			if (info !== undefined) {
				data[field] = record.values[field];
				fields[field] = info;
			} else missing.push(field);
		}
		return frozen({
			key: record.rowKey,
			identity: record.proposal
				? {
						kind: "proposal",
						actionId: record.proposal,
						requested: record.requested ?? record.identity ?? {},
					}
				: { kind: "resource", resource: record.identity },
			data: frozen(data),
			fields: frozen(fields),
			missing: frozen(missing),
			complete: missing.length === 0,
			actionIds: record.actionIds,
		}) as QueryRow;
	}
	activityScope(
		descriptor: QueryDescriptor,
		identity: unknown,
		record?: KnownRecord,
	): boolean {
		if (descriptor.scope === undefined) return true;
		const values = record
			? Object.fromEntries(
					Object.entries(record.values).filter(
						([field]) => !record.fields[field]?.stale,
					),
				)
			: {};
		const match = this.host
			.definition(descriptor.resource)
			.inScope?.(identity, descriptor.scope, values);
		return (
			match === true ||
			(match !== false &&
				record?.identity !== undefined &&
				this.membershipScope({ ...descriptor, where: undefined }, record))
		);
	}
}
