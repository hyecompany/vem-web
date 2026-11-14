// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import type { ActionRegistry } from "../actions.js";
import type {
	AccessUpdate,
	ActionJournal,
	DisclosureProof,
	PersistedFact,
	PersistedMembership,
	RuntimeOptions,
} from "../types.js";
import { equal } from "../values.js";
import type { KnowledgeStore } from "./knowledge.js";
import { restoreFact, restoreMembership } from "./restored-evidence.js";

interface RestorationHost {
	options: RuntimeOptions;
	setAccess(update: AccessUpdate): void;
	readonly closed: boolean;
	grants: AccessRegistry;
	activities: ActionRegistry;
	knowledge: KnowledgeStore;
	batch(work: () => void): void;
	persist(work: Promise<void>): Promise<void>;
	report(error: unknown): void;
	failed(error: unknown): void;
	rebuildEffective(): void;
	changed(): void;
}
export class Restoration {
	pendingRecovery: readonly ActionJournal[] = [];
	quarantinedFacts: readonly PersistedFact[] = [];
	quarantinedMemberships: readonly PersistedMembership[] = [];
	constructor(private readonly host: RestorationHost) {}
	recoverable(): readonly ActionJournal[] {
		return this.pendingRecovery.flatMap((journal) => {
			const bases = this.host.grants
				.surviving(journal.bases)
				.filter(
					(basis) =>
						this.host.grants.independentProof(basis) ||
						journal.snapshot.contextId === this.host.grants.contextId,
				)
				.map((basis) => this.host.grants.adopt(basis));
			return bases.length ? [{ ...journal, bases }] : [];
		});
	}
	private forgetRevoked(): void {
		const surviving = this.host.grants.surviving.bind(this.host.grants);
		this.pendingRecovery = this.pendingRecovery.flatMap((journal) => {
			const bases = surviving(journal.bases);
			return bases.length ? [{ ...journal, bases }] : [];
		});
		this.quarantinedFacts = this.quarantinedFacts.flatMap((fact) => {
			const bases = surviving(fact.bases);
			const disclosureDependencies =
				fact.disclosureDependencies?.map(surviving);
			return bases.length &&
				!disclosureDependencies?.some((proof) => !proof.length)
				? [{ ...fact, bases, disclosureDependencies }]
				: [];
		});
		this.quarantinedMemberships = this.quarantinedMemberships.flatMap(
			(membership) => {
				const bases = surviving(membership.bases);
				return bases.length ? [{ ...membership, bases }] : [];
			},
		);
	}
	private admittedBases(bases: readonly DisclosureProof[], contextId?: string) {
		const surviving = this.host.grants
			.surviving(bases)
			.filter(
				(basis) =>
					this.host.grants.independentProof(basis) ||
					contextId === this.host.grants.contextId,
			)
			.map((basis) => this.host.grants.adopt(basis));
		return this.host.grants.allowsAny(surviving) ? surviving : [];
	}
	private permitted(fact: PersistedFact): boolean {
		const definition = this.host.options.resources.find(
			(value) => value.name === fact.resource,
		);
		return fact.kind === "relationship"
			? definition?.persistRelationship?.(fact.field, fact.identity) === true
			: definition?.persist?.(fact.field, fact.value, fact.identity) === true;
	}
	async hydrate(): Promise<void> {
		const persistence = this.host.options.persistence;
		if (!persistence) return;
		try {
			const pages =
				persistence.loadPages?.(this.host.options.hydrationPageSize ?? 250) ??
				(async function* () {
					yield await persistence.load();
				})();
			for await (const stored of pages) {
				if (this.host.closed) return;
				this.host.batch(() => {
					this.host.grants.restoreBindings(stored.accessBindings ?? []);
					this.host.grants.restoreTombstones(stored.revoked);
					const retiredAccess = this.host.grants.restoreAccess(
						stored.access ?? [],
					);
					const retired = this.host.grants.register([
						...stored.facts.flatMap((fact) => [
							...fact.bases,
							...(fact.disclosureDependencies ?? []).flat(),
						]),
						...stored.memberships.flatMap((membership) => membership.bases),
						...stored.actions.flatMap((action) => action.bases),
					]);
					retired.push(...retiredAccess);
					if (retired.length)
						void this.host.persist(persistence.revoke(retired));
					this.host.setAccess({ decisions: [] });
					const quarantinedFacts: PersistedFact[] = [];
					const quarantinedMemberships: PersistedMembership[] = [];
					const rejected: PersistedFact[] = [];
					for (const original of stored.facts) {
						const fact = original.deleted
							? original
							: this.host.knowledge.protectRestored(original);
						this.host.knowledge.revision = Math.max(
							this.host.knowledge.revision,
							fact.revision,
						);
						if (fact.deleted) {
							if (
								!this.host.knowledge.touched.has(fact.key) &&
								!this.host.knowledge.cells.has(fact.key)
							)
								this.host.knowledge.invalidations.set(fact.key, -1);
							continue;
						}
						if (
							!fact.deleted &&
							(!this.permitted(fact) || fact.bases.length === 0)
						) {
							rejected.push({
								...original,
								deleted: true,
								value: undefined,
								revision: ++this.host.knowledge.revision,
							});
							continue;
						}
						if (
							this.host.knowledge.retiredRecords.has(
								this.host.knowledge.recordKey(fact.resource, fact.identity),
							) ||
							this.host.knowledge.touched.has(fact.key) ||
							this.host.knowledge.cells.has(fact.key)
						)
							continue;
						if (!equal(fact.bases, original.bases))
							rejected.push({
								...fact,
								revision: ++this.host.knowledge.revision,
							});
						const bases = this.admittedBases(fact.bases, fact.contextId);
						if (bases.length)
							this.host.knowledge.putCell(
								restoreFact(fact, bases, this.host.knowledge, this.host.grants),
							);
						else if (this.host.grants.surviving(fact.bases).length > 0)
							quarantinedFacts.push(fact);
					}
					if (rejected.length > 0)
						void this.host.persist(persistence.writeFacts(rejected, []));
					for (const membership of stored.memberships) {
						this.host.knowledge.revision = Math.max(
							this.host.knowledge.revision,
							membership.revision,
						);
						if (
							membership.deleted ||
							this.host.knowledge.touched.has(membership.key) ||
							this.host.knowledge.memberships.has(membership.key)
						)
							continue;
						const bases = this.admittedBases(
							membership.bases,
							membership.contextId,
						);
						if (bases.length)
							this.host.knowledge.memberships.set(
								membership.key,
								restoreMembership(
									membership,
									bases,
									this.host.knowledge,
									this.host.grants,
								),
							);
						else if (this.host.grants.surviving(membership.bases).length > 0)
							quarantinedMemberships.push(membership);
					}
					this.quarantinedFacts = [
						...this.quarantinedFacts,
						...quarantinedFacts,
					];
					this.quarantinedMemberships = [
						...this.quarantinedMemberships,
						...quarantinedMemberships,
					];
					const recovery = [...this.pendingRecovery, ...stored.actions];
					this.pendingRecovery = [
						...recovery.filter(
							(action) =>
								action.snapshot.phase !== "settled" ||
								action.snapshot.outcome?.kind === "unknown",
						),
						...recovery
							.filter(
								(action) =>
									action.snapshot.phase === "settled" &&
									action.snapshot.outcome?.kind !== "unknown",
							)
							.slice(-(this.host.options.maxSettledActions ?? 200)),
					];
					this.forgetRevoked();
					this.host.knowledge.refreshCurrency();
					this.host.knowledge.rebuildRecords();
					this.host.rebuildEffective();
					this.host.changed();
					void this.host.activities.recover(this.recoverable());
				});
			}
		} catch (error) {
			this.host.failed(error);
			this.host.report(error);
		}
	}
	admitQuarantine(): void {
		this.forgetRevoked();
		this.quarantinedFacts = this.quarantinedFacts
			.map((fact) => this.host.knowledge.protectRestored(fact))
			.filter((fact) => {
				if (!this.permitted(fact) || fact.bases.length === 0) return false;
				const bases = this.admittedBases(fact.bases, fact.contextId);
				if (!bases.length) return true;
				if (
					!this.host.knowledge.retiredRecords.has(
						this.host.knowledge.recordKey(fact.resource, fact.identity),
					) &&
					!this.host.knowledge.touched.has(fact.key) &&
					!this.host.knowledge.cells.has(fact.key)
				) {
					this.host.knowledge.putCell(
						restoreFact(fact, bases, this.host.knowledge, this.host.grants),
					);
				}
				return false;
			});
		this.quarantinedMemberships = this.quarantinedMemberships.filter(
			(membership) => {
				const bases = this.admittedBases(
					membership.bases,
					membership.contextId,
				);
				if (!bases.length) return true;
				if (
					!this.host.knowledge.touched.has(membership.key) &&
					!this.host.knowledge.memberships.has(membership.key)
				)
					this.host.knowledge.memberships.set(
						membership.key,
						restoreMembership(
							membership,
							bases,
							this.host.knowledge,
							this.host.grants,
						),
					);
				return false;
			},
		);
	}
	close(): void {
		this.pendingRecovery = [];
		this.quarantinedFacts = [];
		this.quarantinedMemberships = [];
	}
}
