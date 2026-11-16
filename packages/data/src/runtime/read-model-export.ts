// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import {
	type ReadModelDelta,
	rememberReadModelChanges,
} from "../read-model/publication.js";
import type {
	ReadModelFact,
	ReadModelMembership,
	ReadModelRecord,
	ReadModelSnapshot,
} from "../read-model/types.js";
import type { PersistedMembership } from "../types.js";
import { equal, frozen } from "../values.js";
import type { KnowledgeStore } from "./knowledge.js";
import type { PresentationIndex } from "./presentation.js";

export class ReadModelExport {
	private readonly records = new Map<string, ReadModelRecord>();
	private memberships = new Map<string, ReadModelMembership>();
	private membershipValues = new WeakMap<
		PersistedMembership,
		ReadModelMembership
	>();
	private cached?: ReadModelSnapshot;
	constructor(
		private readonly knowledge: KnowledgeStore,
		private readonly presentation: PresentationIndex,
		private readonly grants: AccessRegistry,
	) {}
	snapshot(): ReadModelSnapshot {
		return this.cached ?? this.update();
	}
	update(): ReadModelSnapshot {
		const identityTransitions = this.knowledge.identities.snapshot();
		const changes: ReadModelDelta = {
			identityTransitions,
			revision: this.knowledge.revision,
			records: { upsert: [], remove: [] },
			memberships: { upsert: [], remove: [] },
		};
		const dirty = new Set([
			...this.knowledge.dirtyReadModel,
			...this.presentation.exportedRecords,
		]);
		if (!this.cached) {
			for (const key of this.knowledge.records.keys()) dirty.add(key);
			for (const key of this.presentation.effective.keys()) dirty.add(key);
		}
		const upsert: ReadModelRecord[] = [],
			remove: string[] = [];
		for (const key of dirty) {
			const value = this.record(key);
			if (value) {
				if (value === this.records.get(key)) continue;
				this.records.set(key, value);
				upsert.push(value);
			} else if (this.records.delete(key)) remove.push(key);
		}
		changes.records = { upsert, remove };
		const memberships = this.collectMemberships();
		changes.memberships = {
			upsert: [...memberships.values()].filter(
				(value) => this.memberships.get(value.key) !== value,
			),
			remove: [...this.memberships.keys()].filter(
				(key) => !memberships.has(key),
			),
		};
		this.knowledge.dirtyReadModel.clear();
		this.presentation.exportedRecords.clear();
		const sameRecords = upsert.length === 0 && remove.length === 0;
		const sameMemberships =
			changes.memberships.upsert.length === 0 &&
			changes.memberships.remove.length === 0;
		if (
			this.cached &&
			this.cached.revision === this.knowledge.revision &&
			sameRecords &&
			sameMemberships &&
			equal(this.cached.identityTransitions ?? [], identityTransitions)
		)
			return this.cached;
		const previous = this.cached;
		this.memberships = memberships;
		this.cached = frozen({
			revision: this.knowledge.revision,
			...(identityTransitions.length ? { identityTransitions } : {}),
			records:
				sameRecords && previous ? previous.records : [...this.records.values()],
			memberships:
				sameMemberships && previous
					? previous.memberships
					: [...memberships.values()],
		});
		if (previous) rememberReadModelChanges(previous, this.cached, changes);
		return this.cached;
	}
	private record(key: string): ReadModelRecord | undefined {
		const confirmed = this.knowledge.records.get(key);
		const effective = this.presentation.effective.get(key);
		if (!confirmed && !effective) return undefined;
		const facts: Record<string, ReadModelFact> = {};
		for (const cellKey of this.knowledge.cellsByRecord.get(key) ?? []) {
			const cell = this.knowledge.cells.get(cellKey);
			if (!cell || cell.kind === "relationship" || !this.knowledge.valid(cell))
				continue;
			facts[cell.field] = {
				revision: cell.revision,
				currencyRevision: cell.currencyRevision,
				...(cell.stale ? { stale: true } : {}),
			};
		}
		for (const factKey of this.knowledge.invalidatedByRecord.get(key) ?? []) {
			const ref = this.knowledge.invalidatedFacts.get(factKey);
			const revision = this.knowledge.invalidations.get(factKey);
			if (!ref || revision === undefined) continue;
			const previous = facts[ref.field];
			facts[ref.field] = {
				currencyRevision: previous?.currencyRevision,
				revision: Math.max(previous?.revision ?? 0, revision),
				...(previous?.stale ? { stale: true } : {}),
			};
		}
		const previous = this.records.get(key);
		return previous &&
			previous.confirmed === confirmed &&
			previous.effective === effective &&
			equal(previous.facts, facts)
			? previous
			: frozen({ key, confirmed, effective, facts });
	}
	readMemberships(): readonly ReadModelMembership[] {
		return [...this.collectMemberships().values()];
	}
	private collectMemberships(): Map<string, ReadModelMembership> {
		const memberships = new Map<string, ReadModelMembership>();
		for (const membership of this.knowledge.memberships.values()) {
			if (!this.grants.allowsAny(membership.bases)) continue;
			let value = this.membershipValues.get(membership);
			if (!value) {
				const { key, resource, scope, where, identities, complete, revision } =
					membership;
				value = {
					key,
					resource,
					scope,
					where,
					identities,
					complete,
					observedComplete: membership.supports.some(
						(support) =>
							support.complete && this.grants.allowsAny(support.bases),
					),
					revision,
					currencyRevision: membership.currencyRevision,
					stale: membership.stale,
				};
				const previous = this.memberships.get(key);
				value = previous && equal(previous, value) ? previous : frozen(value);
				this.membershipValues.set(membership, value);
			}
			memberships.set(membership.key, value);
		}
		return memberships;
	}
	close(): void {
		this.cached = undefined;
		this.records.clear();
		this.memberships.clear();
		this.membershipValues = new WeakMap();
		this.knowledge.dirtyReadModel.clear();
		this.knowledge.invalidatedByRecord.clear();
		this.presentation.exportedRecords.clear();
	}
}
