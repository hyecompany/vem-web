// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import { captureBasis, captureProof } from "../access-proofs.js";
import { freezeValue, stableKey } from "../descriptors.js";
import { fieldAccess } from "../read-model/access-requirements.js";
import type {
	ContinuityRef,
	DisclosureBasis,
	DisclosureProof,
	EvidenceRef,
	EvidenceSupport,
	FactObservation,
	FactRef,
	FieldInfo,
	KnownRecord,
	PersistedFact,
	PersistedMembership,
	RelationshipRef,
	ResourceDefinition,
	ResourceReference,
	Values,
} from "../types.js";
import { equal, frozen } from "../values.js";
import {
	ContinuityRegistry,
	type ContinuitySnapshot,
	type Currency,
} from "./continuity.js";
import { EvidenceDependencies } from "./evidence-dependencies.js";
import { EvidenceSupports, mergeSupports } from "./evidence-supports.js";
import {
	cellRef,
	knownRelationship,
	relationshipCells,
} from "./relationships.js";
import type { Cell } from "./state.js";

export class KnowledgeStore {
	readonly cells = new Map<string, Cell>();
	readonly cellsByRecord = new Map<string, Set<string>>();
	readonly dirtyRecords = new Set<string>();
	readonly dirtyEffective = new Set<string>();
	readonly dirtyReadModel = new Set<string>();
	readonly memberships = new Map<string, PersistedMembership>();
	readonly records = new Map<string, KnownRecord>();
	readonly resourceRecords = new Map<string, Set<string>>();
	readonly invalidations = new Map<string, number>();
	readonly invalidatedFacts = new Map<string, FactRef>();
	readonly invalidatedByRecord = new Map<string, Set<string>>();
	readonly continuity = new ContinuityRegistry();
	private readonly evidence: EvidenceSupports;
	private readonly dependencies = new EvidenceDependencies();
	private readonly pendingCurrency = new Set<string>();
	readonly touched = new Set<string>();
	readonly retiredRecords = new Set<string>();
	retentionDirty = false;
	membershipGeneration = 0;
	revision = 0;
	constructor(
		private readonly definitions: ReadonlyMap<string, ResourceDefinition>,
		private readonly grants: AccessRegistry,
		private readonly invalidated: (ref: EvidenceRef) => void,
	) {
		this.evidence = new EvidenceSupports(grants, this.cells, this.continuity);
	}
	recordKey(resource: string, identity: unknown): string {
		const definition = this.definition(resource);
		return `${resource}:${definition.key?.(identity) ?? stableKey(identity)}`;
	}
	private definition(resource: string): ResourceDefinition {
		const definition = this.definitions.get(resource);
		if (!definition) throw new Error(`Unknown resource ${resource}`);
		return definition;
	}
	factKey(ref: EvidenceRef): string {
		return "relationship" in ref
			? `${this.recordKey(ref.resource, ref.identity)}:relationship:${JSON.stringify(ref.relationship)}:${ref.target ? stableKey(ref.target) : "set"}`
			: `${this.recordKey(ref.resource, ref.identity)}:${JSON.stringify(ref.field)}`;
	}
	basis(refs: readonly DisclosureBasis[] | undefined): DisclosureProof[] {
		return this.grants.surviving(
			(refs ?? []).map((ref) =>
				captureBasis(ref, (scope) => this.grants.ref(scope)),
			),
		);
	}
	private fieldBasis(fact: FactObservation, field: string): DisclosureProof[] {
		const evidence =
			fact.fieldBasis?.[field] ?? fact.certifiedBasis ?? fact.basis;
		const supplied = this.basis(evidence);
		const requirement = fieldAccess(
			this.definition(fact.resource),
			field,
			fact.identity,
		);
		if (!requirement || (evidence !== undefined && supplied.length === 0))
			return supplied;
		const proof = captureProof(requirement, (scope) => this.grants.ref(scope));
		if (
			supplied.length === 1 &&
			supplied[0] !== undefined &&
			"all" in supplied[0] &&
			supplied[0].all.some((part) => equal(part, proof))
		)
			return supplied;
		return this.grants.surviving([
			supplied.length ? { all: [{ any: supplied }, proof] } : proof,
		]);
	}
	protectRestored(fact: PersistedFact): PersistedFact {
		if (fact.kind === "relationship") return fact;
		const supports = fact.supports.map((support) => ({
			...support,
			bases: this.fieldBasis(
				{
					resource: fact.resource,
					identity: fact.identity,
					basis: support.bases,
				},
				fact.field,
			),
		}));
		return {
			...fact,
			supports,
			bases: this.fieldBasis(
				{ resource: fact.resource, identity: fact.identity, basis: fact.bases },
				fact.field,
			),
		};
	}
	prune(cell: Cell): Cell | undefined {
		return this.evidence.prune(cell);
	}
	private validSupport(support: EvidenceSupport, path: Set<string>): boolean {
		return this.evidence.validSupport(support, path);
	}
	valid(cell: Cell, path = new Set<string>()): boolean {
		return this.evidence.valid(cell, path);
	}
	disclosure(ref: EvidenceRef): DisclosureProof {
		const cells = this.dependencyKeys(ref).map((key) => this.cells.get(key));
		if (!cells.length || cells.some((cell) => !cell || !this.valid(cell)))
			throw new Error(
				"The requested evidence is not available for disclosure.",
			);
		return { all: cells.map((cell) => this.cellDisclosure(cell as Cell)) };
	}
	private cellDisclosure(cell: Cell): DisclosureProof {
		return this.evidence.cellDisclosure(cell);
	}
	currency(
		cell: Cell,
		path = new Set<string>(),
		memo = new Map<string, Currency>(),
	): Currency {
		return this.evidence.currency(cell, path, memo);
	}
	supportCurrency(
		supports: readonly EvidenceSupport[],
		path = new Set<string>(),
		memo = new Map<string, Currency>(),
	): Currency {
		return this.evidence.supportCurrency(supports, path, memo);
	}
	refreshCurrency(continuity?: ContinuityRef): EvidenceRef[] {
		const changed: EvidenceRef[] = [];
		const memo = new Map<string, Currency>();
		const affected = new Map<string, boolean>();
		const keys = continuity
			? new Set([...this.cells.keys(), ...this.pendingCurrency])
			: this.dependencies.affected(this.pendingCurrency);
		for (const key of keys) {
			this.pendingCurrency.delete(key);
			const cell = this.cells.get(key);
			if (!cell) continue;
			const currency = this.currency(cell, new Set(), memo);
			if (
				currency.stale === Boolean(cell.stale) &&
				currency.liveness === cell.liveness &&
				(!continuity ||
					!this.evidence.usesContinuity(cell, continuity, affected))
			)
				continue;
			this.putCell({ ...cell, ...currency, currencyRevision: ++this.revision });
			this.pendingCurrency.delete(key);
			changed.push(cellRef(cell));
			this.invalidated(cellRef(cell));
		}
		return changed;
	}
	relationship(ref: RelationshipRef) {
		return knownRelationship(this, ref);
	}
	dependencyKeys(ref: EvidenceRef): string[] {
		if (!("relationship" in ref) || ref.target) return [this.factKey(ref)];
		const keys = relationshipCells(this, ref).map((cell) => cell.key);
		return keys.length ? keys : [this.factKey(ref)];
	}
	dependents(keys: Iterable<string>): readonly Cell[] {
		return this.dependencies.direct(keys).flatMap((key) => {
			const cell = this.cells.get(key);
			return cell ? [cell] : [];
		});
	}
	putCell(cell: Cell): void {
		cell.supports = cell.supports.map((support) => ({
			...support,
			bases: this.grants
				.surviving(support.bases)
				.map((basis) => this.grants.adopt(basis)),
			disclosureDependencies: support.disclosureDependencies?.map((proof) =>
				this.grants.surviving(proof).map((basis) => this.grants.adopt(basis)),
			),
		}));
		if (cell.disclosureDependencies)
			cell.disclosureDependencies = cell.disclosureDependencies.map((proof) =>
				this.grants.surviving(proof).map((basis) => this.grants.adopt(basis)),
			);
		freezeValue(cell.value);
		freezeValue(cell.identity);
		this.cells.set(cell.key, cell);
		this.dependencies.set(cell.key, [
			...cell.dependencies,
			...cell.supports.flatMap((support) => support.dependencies),
		]);
		this.pendingCurrency.add(cell.key);
		const key = this.recordKey(cell.resource, cell.identity);
		if (!this.cellsByRecord.has(key)) this.retentionDirty = true;
		const fields = this.cellsByRecord.get(key) ?? new Set<string>();
		fields.add(cell.key);
		this.cellsByRecord.set(key, fields);
		this.dirtyRecords.add(key);
		this.dirtyReadModel.add(key);
	}
	dropCell(key: string): void {
		const cell = this.cells.get(key);
		if (!cell) return;
		this.cells.delete(key);
		this.dependencies.delete(key);
		this.pendingCurrency.add(key);
		const record = this.recordKey(cell.resource, cell.identity);
		const fields = this.cellsByRecord.get(record);
		fields?.delete(key);
		if (fields?.size === 0) this.cellsByRecord.delete(record);
		this.dirtyRecords.add(record);
		this.dirtyReadModel.add(record);
	}
	rebuildRecords(): void {
		for (const key of this.dirtyRecords) {
			let record:
				| {
						resource: string;
						identity: unknown;
						values: Values;
						fields: Record<string, FieldInfo>;
						presence: KnownRecord["presence"];
				  }
				| undefined;
			for (const cellKey of this.cellsByRecord.get(key) ?? []) {
				const cell = this.cells.get(cellKey);
				if (!cell || cell.kind === "relationship" || !this.valid(cell))
					continue;
				record ??= {
					resource: cell.resource,
					identity: cell.identity,
					values: {},
					fields: {},
					presence: "unknown",
				};
				if (cell.field === "$presence")
					record.presence = cell.value as KnownRecord["presence"];
				else {
					record.values[cell.field] = cell.value;
					record.fields[cell.field] = {
						source: cell.source,
						liveness: cell.liveness,
						actionIds: [],
						...(cell.stale ? { stale: true } : {}),
					};
				}
			}
			if (!record) {
				const previous = this.records.get(key);
				if (previous) this.resourceRecords.get(previous.resource)?.delete(key);
				this.records.delete(key);
			} else {
				const value: KnownRecord = {
					key,
					...record,
					values: frozen(record.values),
					fields: frozen(record.fields),
				};
				if (!equal(value, this.records.get(key)))
					this.records.set(key, frozen(value));
				const resourceKeys =
					this.resourceRecords.get(value.resource) ?? new Set<string>();
				resourceKeys.add(key);
				this.resourceRecords.set(value.resource, resourceKeys);
			}
			this.dirtyEffective.add(key);
		}
		this.dirtyRecords.clear();
	}

	ingest(
		fact: FactObservation,
		changed: EvidenceRef[],
		persisted: PersistedFact[],
		relationship?: { name: string; target?: ResourceReference },
		continuity?: ContinuitySnapshot,
	): void {
		for (const field of fact.replace ?? []) {
			if (Object.hasOwn(fact.values ?? {}, field) || field === "$presence")
				continue;
			if (this.fieldBasis(fact, field).length === 0) continue;
			const ref: EvidenceRef = relationship
				? {
						resource: fact.resource,
						identity: fact.identity,
						relationship: relationship.name,
						target: relationship.target,
					}
				: { resource: fact.resource, identity: fact.identity, field };
			const key = this.factKey(ref);
			const previous = this.cells.get(key);
			if (!previous) continue;
			this.dropCell(key);
			this.touched.add(key);
			this.invalidations.set(key, ++this.revision);
			if (!("relationship" in ref)) this.recordInvalidation(key, ref);
			changed.push(ref);
			persisted.push({
				...previous,
				deleted: true,
				value: undefined,
				revision: this.revision,
			});
			for (const dependent of this.dependents([key]))
				if (!dependent.stale) this.invalidate(cellRef(dependent));
		}
		let absenceAccepted = false;
		const entries = Object.entries({
			...fact.values,
			...(fact.presence ? { $presence: fact.presence } : {}),
		});
		for (const [field, value] of entries) {
			const ref: EvidenceRef = relationship
				? {
						resource: fact.resource,
						identity: fact.identity,
						relationship: relationship.name,
						target: relationship.target,
					}
				: { resource: fact.resource, identity: fact.identity, field };
			const key = this.factKey(ref),
				old = this.cells.get(key);
			let bases = this.fieldBasis(fact, field);
			const dependencies = (fact.dependsOn ?? []).flatMap((dependency) =>
				this.dependencyKeys(dependency),
			);
			if (dependencies.length > 0) {
				if (dependencies.some((dependency) => !this.cells.has(dependency)))
					continue;
				if (
					!fact.basis &&
					!fact.certifiedBasis &&
					!fact.fieldBasis?.[field] &&
					!fieldAccess(this.definition(fact.resource), field, fact.identity)
				)
					bases = [
						...new Map(
							dependencies
								.flatMap(
									(dependency) => this.cells.get(dependency)?.bases ?? [],
								)
								.map((basis) => [stableKey(basis), basis]),
						).values(),
					];
			}
			if (bases.length === 0) continue;
			if (field === "$presence" && value === "absent") absenceAccepted = true;
			const source = fact.dependsOn ? "derived" : "observed";
			const support: EvidenceSupport = {
				bases,
				dependencies,
				disclosureDependencies: fact.certifiedBasis
					? []
					: dependencies.map((key) => [
							this.cellDisclosure(this.cells.get(key) as Cell),
						]),
				independentDisclosure: fact.certifiedBasis !== undefined,
				liveness: this.continuity.capture(
					fact.fieldLiveness?.[field] ??
						fact.liveness ??
						(dependencies.length ? "immutable" : "snapshot"),
					continuity,
				),
			};
			const retained =
				old && equal(old.value, value)
					? old.supports.filter((entry) =>
							this.validSupport(entry, new Set([key])),
						)
					: [];
			const supports = mergeSupports([...retained, support]);
			bases = [
				...new Map(
					supports
						.map((entry) => ({
							all: [
								{ any: entry.bases },
								...(entry.independentDisclosure
									? []
									: (entry.disclosureDependencies ?? []).map((proof) => ({
											any: proof,
										}))),
							],
						}))
						.map((basis) => [stableKey(basis), basis]),
				).values(),
			];
			if (
				old &&
				equal(old.value, value) &&
				equal(old.supports, supports) &&
				!old.stale &&
				(source === "derived" ||
					(field !== "$presence" &&
						(!relationship || relationship.target !== undefined)))
			)
				continue;
			const cell: Cell = {
				key,
				...(relationship
					? {
							kind: "relationship" as const,
							relationshipTarget: freezeValue(
								structuredClone(relationship.target),
							),
						}
					: {}),
				resource: fact.resource,
				identity: freezeValue(structuredClone(fact.identity)),
				field,
				value: freezeValue(structuredClone(value)),
				bases,
				dependencies: [
					...new Set(supports.flatMap((entry) => entry.dependencies)),
				],
				supports,
				...this.supportCurrency(supports),
				source,
				contextId: this.grants.contextId,
				revision: ++this.revision,
			};
			this.putCell(cell);
			this.touched.add(key);
			changed.push(ref);
			if (
				relationship
					? this.definitions
							.get(fact.resource)
							?.persistRelationship?.(relationship.name, fact.identity)
					: this.definitions
							.get(fact.resource)
							?.persist?.(field, value, fact.identity)
			)
				persisted.push(cell);
		}
		if (absenceAccepted) {
			const recordKey = this.recordKey(fact.resource, fact.identity);
			this.retiredRecords.add(recordKey);
			for (const key of [...(this.cellsByRecord.get(recordKey) ?? [])]) {
				const cell = this.cells.get(key);
				if (!cell || cell.field === "$presence") continue;
				const ref = cellRef(cell);
				this.invalidate(ref);
				changed.push(ref);
				this.dropCell(key);
				this.touched.add(key);
				persisted.push({
					...cell,
					deleted: true,
					value: undefined,
					revision: ++this.revision,
				});
			}
		}
	}

	private recordInvalidation(key: string, ref: FactRef): void {
		this.invalidatedFacts.set(key, frozen(structuredClone(ref)));
		const record = this.recordKey(ref.resource, ref.identity);
		const fields = this.invalidatedByRecord.get(record) ?? new Set<string>();
		fields.add(key);
		this.invalidatedByRecord.set(record, fields);
		this.dirtyReadModel.add(record);
	}

	invalidate(ref: EvidenceRef, changedCells?: PersistedFact[]): void {
		const key = this.factKey(ref);
		this.invalidations.set(key, ++this.revision);
		if (!("relationship" in ref)) this.recordInvalidation(key, ref);
		this.touched.add(key);
		const cell = this.cells.get(key);
		if (cell) {
			const next = {
				...cell,
				supports: cell.supports.map((support) => ({ ...support, stale: true })),
				stale: true,
			};
			this.putCell(next);
			changedCells?.push(next);
		}
		this.invalidated(ref);
		for (const dependent of this.dependents([key])) {
			if (dependent.stale) continue;
			const supports = dependent.supports.map((support) =>
				support.dependencies.includes(key)
					? { ...support, stale: true }
					: support,
			);
			const next = { ...dependent, supports };
			const currency = this.currency(next);
			this.putCell({ ...next, ...currency });
			changedCells?.push({ ...next, ...currency });
			if (currency.stale) this.invalidate(cellRef(dependent), changedCells);
		}
	}

	close(): void {
		this.cells.clear();
		this.cellsByRecord.clear();
		this.dependencies.clear();
		this.pendingCurrency.clear();
		this.dirtyRecords.clear();
		this.dirtyEffective.clear();
		this.dirtyReadModel.clear();
		this.memberships.clear();
		this.membershipGeneration = 0;
		this.records.clear();
		this.resourceRecords.clear();
		this.invalidations.clear();
		this.invalidatedFacts.clear();
		this.invalidatedByRecord.clear();
		this.continuity.clear();
		this.touched.clear();
		this.retiredRecords.clear();
	}
}
