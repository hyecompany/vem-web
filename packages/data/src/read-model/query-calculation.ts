// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type {
	KnownRecord,
	QueryDescriptor,
	QueryIssue,
	QueryResult,
	QueryRow,
	Values,
} from "../types.js";
import { equal } from "../values.js";
import { deniedScopes, readAccess } from "./access-requirements.js";
import type { QueryMatching } from "./query-matching.js";
import type { QueryRequirements } from "./query-requirements.js";
import type { QueryKnowledge } from "./query-types.js";
import type { MissingRequirement } from "./requirements.js";

interface ConfirmedContribution {
	record: KnownRecord;
	match: boolean | "unknown";
	denied: string[];
}
interface RowContribution {
	row: QueryRow;
	match: true | "unknown";
	order: Readonly<Values>;
}
interface RequirementContribution {
	forced: readonly string[];
	records: Map<string, MissingRequirement[]>;
	value?: MissingRequirement[];
}

export class QueryCalculation {
	revision = 0;
	snapshot?: QueryResult;
	count = 0;
	unknown = 0;
	private readonly confirmed = new Map<string, ConfirmedContribution>();
	private readonly confirmedOrder = new Map<string, number>();
	private readonly effectiveOrder = new Map<string, number>();
	private readonly memberIdentities = new Map<string, unknown>();
	private readonly memberOrder = new Map<string, number>();
	private readonly candidates = new Map<string, unknown>();
	private readonly matches = new Map<string, RowContribution>();
	private readonly recordActivities = new Map<string, readonly string[]>();
	readonly projectedActivities = new Map<string, number>();
	private readonly variants = new Map<string, RequirementContribution>();
	private readonly requestedFields: readonly string[];
	private sequence = 0;
	private issues?: QueryIssue[];
	private rowsValue: QueryRow[] = [];
	private unresolvedValue: QueryRow[] = [];
	private rowsDirty = true;

	constructor(
		readonly descriptor: QueryDescriptor,
		private readonly host: QueryKnowledge,
		private readonly matching: QueryMatching,
		private readonly acquisition: QueryRequirements,
	) {
		const definition = host.definition(descriptor.resource);
		this.requestedFields = [
			...new Set([
				...descriptor.select,
				...Object.keys(descriptor.where ?? {}),
				...(descriptor.orderBy ?? []).map((order) => order.field),
				...(definition.queryDependencies?.(descriptor) ?? []),
			]),
		];
		const keys = new Set<string>();
		if (descriptor.mode === "one") {
			keys.add(host.recordKey(descriptor.resource, descriptor.identity));
		} else {
			for (const key of host.resourceRecords.get(descriptor.resource) ?? []) {
				this.confirmedOrder.set(key, this.sequence++);
				keys.add(key);
			}
			for (const record of host.effectiveRecords(descriptor.resource)) {
				this.effectiveOrder.set(record.key, this.sequence++);
				keys.add(record.key);
			}
			for (const membership of host.memberships()) {
				if (
					membership.resource !== descriptor.resource ||
					!equal(membership.scope, descriptor.scope) ||
					!matching.coversFilter(descriptor, membership.where)
				)
					continue;
				for (const identity of membership.identities) {
					const key = host.recordKey(descriptor.resource, identity);
					if (!this.memberOrder.has(key))
						this.memberOrder.set(key, this.sequence++);
					this.memberIdentities.set(key, identity);
					keys.add(key);
				}
			}
		}
		this.update(keys);
	}

	update(keys: Iterable<string>): void {
		for (const key of keys) this.updateRecord(key);
	}

	private updateRecord(key: string): void {
		const descriptor = this.descriptor;
		if (
			descriptor.mode === "one" &&
			key !== this.host.recordKey(descriptor.resource, descriptor.identity)
		)
			return;
		const record = this.host.records.get(key);
		const effective = this.host.effective(key);
		const previous = this.confirmed.get(key);
		if (
			record?.resource !== descriptor.resource &&
			effective?.resource !== descriptor.resource &&
			!previous &&
			!this.effectiveOrder.has(key) &&
			!this.memberIdentities.has(key) &&
			descriptor.mode !== "one"
		)
			return;
		const next =
			record?.resource === descriptor.resource
				? {
						record,
						match: this.matching.match(descriptor, record),
						denied: this.denied(record.identity),
					}
				: undefined;
		if (previous?.record.presence === "present") {
			if (previous.match === true) this.count--;
			if (previous.match === "unknown") this.unknown--;
		}
		if (next?.record.presence === "present") {
			if (next.match === true) this.count++;
			if (next.match === "unknown") this.unknown++;
		}
		if (next) {
			this.confirmed.set(key, next);
			if (!this.confirmedOrder.has(key))
				this.confirmedOrder.set(key, this.sequence++);
		} else {
			this.confirmed.delete(key);
			this.confirmedOrder.delete(key);
		}
		if (!equal(previous?.denied, next?.denied) || !!previous !== !!next)
			this.issues = undefined;

		const oldRow = this.matches.get(key);
		let nextRow: RowContribution | undefined;
		let actionIds: readonly string[] = [];
		if (effective?.resource === descriptor.resource) {
			if (!this.effectiveOrder.has(key))
				this.effectiveOrder.set(key, this.sequence++);
			const match = this.matching.match(descriptor, effective);
			if (match !== false) {
				const row = this.matching.row(descriptor, effective);
				const values = descriptor.orderBy
					? this.matching.readable(descriptor, effective).values
					: {};
				nextRow = {
					row: oldRow && equal(oldRow.row, row) ? oldRow.row : row,
					match,
					order: Object.fromEntries(
						(descriptor.orderBy ?? []).map((order) => [
							order.field,
							values[order.field],
						]),
					),
				};
			}
			if (
				descriptor.mode === "list" &&
				effective.actionIds.length > 0 &&
				this.matching.activityScope(
					descriptor,
					effective.identity ?? effective.requested,
					effective,
				)
			)
				actionIds = effective.actionIds;
		} else {
			this.effectiveOrder.delete(key);
		}
		if (nextRow) this.matches.set(key, nextRow);
		else this.matches.delete(key);
		if (
			oldRow?.row !== nextRow?.row ||
			oldRow?.match !== nextRow?.match ||
			!equal(oldRow?.order, nextRow?.order)
		)
			this.rowsDirty = true;
		const oldActions = this.recordActivities.get(key) ?? [];
		if (!equal(oldActions, actionIds)) {
			for (const id of oldActions) {
				const count = (this.projectedActivities.get(id) ?? 0) - 1;
				if (count > 0) this.projectedActivities.set(id, count);
				else this.projectedActivities.delete(id);
			}
			for (const id of actionIds)
				this.projectedActivities.set(
					id,
					(this.projectedActivities.get(id) ?? 0) + 1,
				);
			if (actionIds.length > 0) this.recordActivities.set(key, actionIds);
			else this.recordActivities.delete(key);
		}

		const wasCandidate = this.candidates.has(key);
		if (descriptor.mode === "one")
			this.candidates.set(key, descriptor.identity);
		else if (
			(!next || next.match !== false) &&
			(next || this.memberIdentities.has(key))
		) {
			this.candidates.set(
				key,
				this.memberIdentities.has(key)
					? this.memberIdentities.get(key)
					: next?.record.identity,
			);
		} else this.candidates.delete(key);
		for (const variant of this.variants.values()) {
			this.updateRequirements(variant, key);
			if (wasCandidate !== this.candidates.has(key)) variant.value = undefined;
		}
	}

	private denied(identity: unknown): string[] {
		return this.requestedFields.filter(
			(field) =>
				this.matching.fieldAccess(this.descriptor, identity, field) ===
				"denied",
		);
	}

	accessIssues(): QueryIssue[] {
		if (this.issues) return this.issues;
		const fields = new Set<string>();
		for (const contribution of this.confirmed.values())
			for (const field of contribution.denied) fields.add(field);
		if (this.confirmed.size === 0)
			for (const field of this.denied(this.descriptor.identity))
				fields.add(field);
		const denied = deniedScopes(
			readAccess(
				this.host.definition(this.descriptor.resource),
				this.descriptor,
			),
			(scope) => this.host.access(scope),
		);
		this.issues = [
			...[...fields].map((field) => ({
				kind: "access" as const,
				message: `Read access to ${field} was revoked`,
			})),
			...denied.map((scope) => ({
				kind: "access" as const,
				scope,
				message: "Read access was revoked",
			})),
		];
		return this.issues;
	}

	rows(): { rows: QueryRow[]; unresolved: QueryRow[] } {
		if (this.rowsDirty) {
			const ordered = [...this.matches].sort(
				([a], [b]) =>
					(this.effectiveOrder.get(a) ?? 0) - (this.effectiveOrder.get(b) ?? 0),
			);
			const rows = ordered.filter(([, value]) => value.match === true);
			if (this.descriptor.orderBy)
				rows.sort(([, a], [, b]) => {
					for (const order of this.descriptor.orderBy ?? []) {
						const left = a.order[order.field],
							right = b.order[order.field];
						if (equal(left, right)) continue;
						const result =
							left === undefined
								? 1
								: right === undefined
									? -1
									: String(left).localeCompare(String(right), undefined, {
											numeric: true,
										});
						return order.direction === "desc" ? -result : result;
					}
					return a.row.key.localeCompare(b.row.key);
				});
			const nextRows = rows.map(([, value]) => value.row);
			const nextUnresolved = ordered
				.filter(([, value]) => value.match === "unknown")
				.map(([, value]) => value.row);
			if (!sameItems(this.rowsValue, nextRows)) this.rowsValue = nextRows;
			if (!sameItems(this.unresolvedValue, nextUnresolved))
				this.unresolvedValue = nextUnresolved;
			this.rowsDirty = false;
		}
		return { rows: this.rowsValue, unresolved: this.unresolvedValue };
	}

	requirements(forced: readonly string[]): MissingRequirement[] {
		const key = stableKey(forced);
		let variant = this.variants.get(key);
		if (!variant) {
			variant = { forced, records: new Map() };
			for (const candidate of this.candidates.keys())
				this.updateRequirements(variant, candidate);
			this.variants.set(key, variant);
			if (this.variants.size > 4)
				this.variants.delete(this.variants.keys().next().value as string);
		}
		if (!variant.value) {
			const collection = this.acquisition.collection(
				this.descriptor,
				forced,
				this.candidates.size,
			);
			const ordered = [...variant.records].sort(([a], [b]) => {
				const confirmedA = this.confirmedOrder.get(a),
					confirmedB = this.confirmedOrder.get(b);
				if (confirmedA !== undefined && confirmedB === undefined) return -1;
				if (confirmedA === undefined && confirmedB !== undefined) return 1;
				return (
					(confirmedA ?? this.memberOrder.get(a) ?? 0) -
					(confirmedB ?? this.memberOrder.get(b) ?? 0)
				);
			});
			variant.value = [
				...collection,
				...ordered.flatMap(([, values]) => values),
			];
		}
		return variant.value;
	}

	private updateRequirements(
		variant: RequirementContribution,
		key: string,
	): void {
		const next = this.candidates.has(key)
			? this.acquisition.record(
					this.descriptor,
					key,
					this.candidates.get(key),
					variant.forced,
				)
			: [];
		const previous = variant.records.get(key) ?? [];
		if (equal(previous, next)) return;
		if (next.length > 0) variant.records.set(key, next);
		else variant.records.delete(key);
		variant.value = undefined;
	}
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}
