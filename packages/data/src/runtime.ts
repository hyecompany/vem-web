// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { AccessRegistry } from "./access.js";
import {
	captureProof,
	proofLeaves,
	requirementScopes,
} from "./access-proofs.js";
import { ActionRegistry } from "./actions.js";
import { stableKey } from "./descriptors.js";
import { deletedFact, deletedMembership } from "./persistence-records.js";
import {
	evaluateAccess,
	fieldAccess,
	readAccess,
} from "./read-model/access-requirements.js";
import { readModelChanges } from "./read-model/publication.js";
import { QueryProjection } from "./read-model/query-projector.js";
import type { ReadModelSnapshot } from "./read-model/types.js";
import { AcquisitionQueue } from "./runtime/acquisition.js";
import { authorityPersistence } from "./runtime/authority-persistence.js";
import type { ContinuitySnapshot } from "./runtime/continuity.js";
import { EditAdmission } from "./runtime/edit-admission.js";
import { createResourceContext } from "./runtime/evidence-context.js";
import { mergeSupports } from "./runtime/evidence-supports.js";
import { KnowledgeStore } from "./runtime/knowledge.js";
import { membershipKey, withdrawMembership } from "./runtime/memberships.js";
import { PresentationIndex } from "./runtime/presentation.js";
import { QueryRegistry } from "./runtime/queries.js";
import { ReadModelExport } from "./runtime/read-model-export.js";
import { cellRef, ingestRelationship } from "./runtime/relationships.js";
import { Restoration } from "./runtime/restoration.js";
import { trimKnowledge } from "./runtime/retention.js";
import type { QueryState } from "./runtime/state.js";
import type {
	AccessSnapshot,
	AccessState,
	AccessUpdate,
	ActionHandle,
	ActionOutcome,
	ActionSnapshot,
	Availability,
	CommandDescriptor,
	CommandResult,
	ContinuityRef,
	DataClient,
	EditDescriptor,
	EvidenceRef,
	KnownMembership,
	ObservationBatch,
	PersistedFact,
	PersistedMembership,
	PreparedEdit,
	QueryDescriptor,
	QueryHandle,
	QueryResult,
	ResourceContext,
	ResourceDefinition,
	RuntimeOptions,
	Values,
	Watch,
} from "./types.js";
import { equal, frozen } from "./values.js";

export { DexiePersistence, persistenceSchemaVersion } from "./persistence.js";
export type * from "./types.js";

export class Runtime implements DataClient {
	private readonly knowledge: KnowledgeStore;
	private readonly restoration: Restoration;
	private readonly presentation: PresentationIndex;
	private readonly queryProjection: QueryProjection;
	private readonly readModel: ReadModelExport;
	private projectionModel?: ReadModelSnapshot;
	private projectionAccessRevision = -1;
	private projectionMembershipGeneration = -1;
	private readonly acquisitions: AcquisitionQueue;
	private readonly edits: EditAdmission;
	private readonly definitions = new Map<string, ResourceDefinition>();
	private readonly grants: AccessRegistry;
	private readonly queries: QueryRegistry;
	private readonly listeners = new Set<() => void>();
	private readonly pendingWrites = new Set<Promise<void>>();
	private readonly activities: ActionRegistry;
	private depth = 0;
	private publishing = false;
	private changed = false;
	private closed = false;
	private persistenceError: unknown;
	readonly ready: Promise<void>;

	constructor(private readonly options: RuntimeOptions) {
		for (const value of [
			options.maxConcurrentActions ?? 4,
			options.maxAcquisitionsPerRead ?? 4096,
			options.maxPendingActions ?? 1000,
			options.maxUnresolvedActions ?? 1000,
		])
			if (!Number.isInteger(value) || value < 1)
				throw new Error(
					"Action concurrency and pending limits must be positive integers",
				);
		if (
			!Number.isInteger(options.maxInactiveRecords ?? 10000) ||
			(options.maxInactiveRecords ?? 10000) < 0
		)
			throw new Error("maxInactiveRecords must be non-negative");
		if (
			!Number.isInteger(options.maxConcurrent ?? 4) ||
			(options.maxConcurrent ?? 4) < 1
		)
			throw new Error("maxConcurrent must be a positive integer");
		if (
			!Number.isInteger(options.maxInactiveQueries ?? 100) ||
			(options.maxInactiveQueries ?? 100) < 0
		)
			throw new Error("maxInactiveQueries must be a non-negative integer");
		if (
			!Number.isInteger(options.maxSettledActions ?? 200) ||
			(options.maxSettledActions ?? 200) < 1
		)
			throw new Error("maxSettledActions must be a positive integer");
		for (const resource of options.resources) {
			if (this.definitions.has(resource.name))
				throw new Error(`Duplicate resource ${resource.name}`);
			this.definitions.set(resource.name, resource);
		}
		this.grants = new AccessRegistry(options.contextId, options.access);
		if (options.persistence) {
			options = {
				...options,
				persistence: authorityPersistence(options.persistence, this.grants),
			};
			this.options = options;
		}
		this.knowledge = new KnowledgeStore(
			this.definitions,
			this.grants,
			(ref) => {
				for (const state of this.queries.states.values())
					if (
						state.descriptor.resource === ref.resource &&
						(state.descriptor.mode === "list" ||
							this.knowledge.recordKey(
								ref.resource,
								state.descriptor.identity,
							) === this.knowledge.recordKey(ref.resource, ref.identity))
					)
						state.version++;
			},
		);
		this.activities = new ActionRegistry({
			access: this.grants,
			persistence: options.persistence,
			transfers: options.transfers,
			transferFetch: options.transferFetch,
			checkpointTimeoutMs: options.checkpointTimeoutMs ?? 1500,
			maxSettledActions: options.maxSettledActions ?? 200,
			maxConcurrentActions: options.maxConcurrentActions ?? 4,
			maxPendingActions: options.maxPendingActions ?? 1000,
			maxUnresolvedActions: options.maxUnresolvedActions ?? 1000,
			definition: (command) =>
				this.definitions.get(command.resource)?.commands?.[command.name],
			availability: (command) => this.commandAvailability(command),
			context: (signal) => this.context(signal),
			changed: () =>
				this.batch(() => {
					this.changed = true;
					this.rebuildEffective();
				}),
			persist: (work) => this.persist(work),
			report: (error) => this.report(error),
		});
		this.presentation = new PresentationIndex({
			activities: this.activities,
			grants: this.grants,
			records: this.knowledge.records,
			definitions: this.definitions,
			dirtyEffective: this.knowledge.dirtyEffective,
			recordKey: (resource, identity) =>
				this.knowledge.recordKey(resource, identity),
			basis: (refs) => this.knowledge.basis(refs),
			context: (signal) => this.context(signal),
		});
		this.readModel = new ReadModelExport(
			this.knowledge,
			this.presentation,
			this.grants,
		);
		this.queryProjection = new QueryProjection({
			definition: (resource) => this.definition(resource),
			recordKey: (resource, identity) =>
				this.knowledge.recordKey(resource, identity),
			factKey: (ref) => this.knowledge.factKey(ref),
			access: (scope) => this.access(scope),
			revision: () => this.knowledge.revision,
			records: this.knowledge.records,
			effective: (key) => this.presentation.get(key),
			effectiveRecords: (resource) => this.presentation.records(resource),
			resourceRecords: this.knowledge.resourceRecords,
			memberships: () => this.readModel.snapshot().memberships,
			cells: this.knowledge.cells,
			invalidations: this.knowledge.invalidations,
			activities: () => this.activities.list(),
			revalidating: (query, requirements) =>
				this.acquisitions.revalidating(query, requirements),
		});
		const runtime = this;
		this.queries = new QueryRegistry(
			{
				get closed() {
					return runtime.closed;
				},
				projection: this.queryProjection,
				supports: (resource) => this.definitions.has(resource),
				changed: () => {
					this.changed = true;
				},
				publish: () => this.publish(),
				schedule: () => this.acquisitions.schedule(),
				released: () =>
					this.batch(() => {
						this.knowledge.retentionDirty = true;
						this.trimKnowledge();
					}),
			},
			options.maxInactiveQueries ?? 100,
		);
		this.acquisitions = new AcquisitionQueue(
			{
				queries: this.queries.states,
				evidenceGeneration: (ref) => {
					const key = this.knowledge.factKey(ref);
					const prefix =
						"relationship" in ref && ref.target === undefined
							? `${this.knowledge.recordKey(ref.resource, ref.identity)}:relationship:${JSON.stringify(ref.relationship)}:`
							: undefined;
					let generation = this.knowledge.invalidations.get(key) ?? 0;
					for (const [cellKey, cell] of this.knowledge.cells)
						if (
							(cellKey === key || (prefix && cellKey.startsWith(prefix))) &&
							cell.stale
						)
							generation = Math.max(
								generation,
								cell.currencyRevision ?? cell.revision,
							);
					if (prefix)
						for (const [cellKey, revision] of this.knowledge.invalidations)
							if (cellKey.startsWith(prefix))
								generation = Math.max(generation, revision);
					return generation;
				},
				needs: (state) => this.queryProjection.needs(state),
				accessIssue: (query) => this.queryProjection.accessIssues(query)[0],
				requirements: (query, forcedFields) =>
					this.queryProjection.requirements(query, forcedFields),
				definition: (resource) => this.definition(resource),
				context: (signal) => this.context(signal),
				errorGuard: (states, source) => {
					if (!source)
						return this.grants.errorGuard(
							states.length
								? states.flatMap((state) =>
										requirementScopes(
											readAccess(
												this.definition(state.descriptor.resource),
												state.descriptor,
											) ?? { all: [] },
										),
									)
								: undefined,
						);
					const definition = this.definition(source.resource);
					const admission =
						typeof source.source.access === "function"
							? source.source.access(
									source.request,
									this.context(new AbortController().signal),
								)
							: source.source.access;
					const requirements = [
						...states.map(
							(state) =>
								readAccess(
									this.definition(state.descriptor.resource),
									state.descriptor,
								) ?? { all: [] },
						),
						...(admission ? [admission] : []),
						...(source.request.identity === undefined
							? []
							: source.request.fields.flatMap((field) => {
									const requirement = fieldAccess(
										definition,
										field,
										source.request.identity,
									);
									return requirement ? [requirement] : [];
								})),
					];
					return this.grants.proofGuard(
						captureProof({ all: requirements }, (scope) =>
							this.grants.ref(scope),
						),
					);
				},
				batch: (work) => this.batch(work),
				changed: () => {
					this.knowledge.revision++;
					this.changed = true;
				},
			},
			options.maxConcurrent ?? 4,
			options.maxAcquisitionsPerRead ?? 4096,
		);
		this.edits = new EditAdmission({
			grants: this.grants,
			definitions: this.definitions,
			acquisitions: this.acquisitions,
			get closed() {
				return runtime.closed;
			},
			context: (signal) => this.context(signal),
			read: (query, options) => this.read(query, options),
			peekQuery: (query) => this.peekQuery(query),
			watch: (query) => this.watch(query),
			accessIssue: (query) => this.queryProjection.accessIssues(query)[0],
			readAvailable: (query) =>
				this.queryProjection.requirements(query).length === 0 &&
				this.queryProjection.accessIssues(query).length === 0,
			access: (scope) => this.access(scope),
			run: (command, options) => this.run(command, options),
		});
		this.restoration = new Restoration({
			options,
			setAccess: (update) => this.setAccess(update),
			get closed() {
				return runtime.closed;
			},
			grants: this.grants,
			activities: this.activities,
			knowledge: this.knowledge,
			batch: (work) => this.batch(work),
			persist: (work) => this.persist(work),
			report: (error) => this.report(error),
			failed: (error) => {
				this.persistenceError = error;
			},
			rebuildEffective: () => this.rebuildEffective(),
			changed: () => {
				this.changed = true;
			},
		});
		this.ready = this.restoration.hydrate().then(async () => {
			const bindings = this.grants.bindingsSnapshot();
			if (bindings.length && options.persistence?.writeAccessBindings)
				await this.persist(
					options.persistence.writeAccessBindings(bindings),
				).catch(() => undefined);
		});
	}

	private definition(resource: string): ResourceDefinition {
		const definition = this.definitions.get(resource);
		if (!definition) throw new Error(`Unknown resource ${resource}`);
		return definition;
	}
	private report(error: unknown): void {
		try {
			this.options.onError?.(error);
		} catch {
			/* Error reporting cannot interrupt an accepted publication. */
		}
	}
	private notify(listener: () => void): void {
		try {
			listener();
		} catch (error) {
			this.report(error);
		}
	}
	private persist(work: Promise<void>): Promise<void> {
		this.pendingWrites.add(work);
		void work.then(
			() => {
				this.pendingWrites.delete(work);
			},
			(error) => {
				this.pendingWrites.delete(work);
				this.persistenceError = error;
				this.report(error);
			},
		);
		return work;
	}
	async flush(): Promise<void> {
		await this.ready;
		while (this.pendingWrites.size > 0)
			await Promise.all([...this.pendingWrites]);
		if (this.persistenceError !== undefined) throw this.persistenceError;
	}

	private batch<T>(work: () => T): T {
		this.depth++;
		try {
			return work();
		} finally {
			this.depth--;
			if (this.depth === 0) this.publish();
		}
	}
	private publish(): void {
		if (this.depth > 0 || this.publishing || !this.changed || this.closed)
			return;
		this.publishing = true;
		try {
			do {
				this.changed = false;
				this.queries.trimInactive();
				this.trimKnowledge();
				const dirty = new Set([
					...this.knowledge.dirtyReadModel,
					...this.presentation.exportedRecords,
				]);
				const model = this.readModel.update();
				const changes =
					this.projectionModel && readModelChanges(this.projectionModel, model);
				const accessRevision = this.grants.snapshot().revision;
				this.queryProjection.changed(
					dirty,
					!changes ||
						this.projectionModel?.memberships !== model.memberships ||
						this.projectionAccessRevision !== accessRevision ||
						this.projectionMembershipGeneration !==
							this.knowledge.membershipGeneration,
				);
				this.projectionModel = model;
				this.projectionAccessRevision = accessRevision;
				this.projectionMembershipGeneration =
					this.knowledge.membershipGeneration;
				const notifications = new Set<() => void>();
				const staged: { state: QueryState; snapshot: QueryResult }[] = [];
				for (const state of this.queries.states.values()) {
					const snapshot = this.queryProjection.snapshot(state);
					if (snapshot === state.projected) continue;
					state.projected = snapshot;
					if (
						!equal(
							{ ...snapshot, revision: 0 },
							{ ...state.snapshot, revision: 0 },
						)
					)
						staged.push({ state, snapshot });
				}
				for (const { state, snapshot } of staged) {
					state.snapshot = frozen(snapshot);
					for (const callback of state.listeners) notifications.add(callback);
				}
				for (const callback of notifications) this.notify(callback);
				for (const callback of [...this.listeners]) this.notify(callback);
				this.activities.flushNotifications();
			} while (this.changed);
		} finally {
			this.publishing = false;
		}
		this.acquisitions.schedule();
	}

	private trimKnowledge(): void {
		trimKnowledge({
			knowledge: this.knowledge,
			presentation: this.presentation,
			queries: this.queries,
			projection: this.queryProjection,
			memberships: () => this.readModel.readMemberships(),
			restoration: this.restoration,
			activities: this.activities,
			options: this.options,
			definition: (resource) => this.definition(resource),
			rebuildEffective: () => this.rebuildEffective(),
			changed: () => {
				this.changed = true;
			},
		});
	}
	private rebuildEffective(): void {
		if (this.presentation.update()) this.changed = true;
	}

	observe(batch: ObservationBatch): void {
		this.observeEvidence(batch, this.knowledge.continuity.snapshot());
	}
	private observeEvidence(
		batch: ObservationBatch,
		continuity: ContinuitySnapshot,
	): void {
		if (this.closed) return;
		this.batch(() => {
			if (batch.grants?.length) this.setAccess({ decisions: batch.grants });
			const changed: EvidenceRef[] = [];
			const persisted: PersistedFact[] = [];
			const persistedMemberships: PersistedMembership[] = [];
			for (const fact of batch.facts ?? [])
				this.knowledge.ingest(fact, changed, persisted, undefined, continuity);
			for (const relationship of batch.relationships ?? [])
				ingestRelationship(
					this.knowledge,
					relationship,
					changed,
					persisted,
					continuity,
				);
			for (const membership of batch.memberships ?? []) {
				for (const identity of membership.identities)
					this.knowledge.ingest(
						{
							resource: membership.resource,
							identity,
							presence: "present",
							basis: membership.basis,
							liveness: membership.liveness,
						},
						changed,
						persisted,
						undefined,
						continuity,
					);
				const key = membershipKey(membership);
				const bases = this.knowledge.basis(membership.basis);
				const support = {
					bases,
					dependencies: [],
					complete: membership.complete,
					liveness: this.knowledge.continuity.capture(
						membership.liveness,
						continuity,
					),
				};
				const previous = this.knowledge.memberships.get(key);
				const retained =
					previous && equal(previous.identities, membership.identities)
						? previous.supports.filter((entry) =>
								this.grants.allowsAny(entry.bases),
							)
						: [];
				const supports = mergeSupports([...retained, support]);
				const stale = this.knowledge.supportCurrency(supports).stale;
				const revision = ++this.knowledge.revision;
				const value: PersistedMembership = {
					...membership,
					key,
					bases: supports.flatMap((entry) => entry.bases),
					supports,
					observedComplete: supports.some((entry) => entry.complete),
					stale,
					currencyRevision: stale ? revision : undefined,
					complete: supports.some(
						(entry) =>
							entry.complete && !this.knowledge.supportCurrency([entry]).stale,
					),
					contextId: this.grants.contextId,
					revision,
				};
				this.knowledge.touched.add(key);
				if (value.bases.length > 0) {
					this.knowledge.memberships.set(key, value);
					persistedMemberships.push(value);
				}
			}
			const invalidated: PersistedFact[] = [];
			for (const ref of batch.invalidate ?? []) {
				this.knowledge.invalidate(ref, invalidated);
				const key = this.knowledge.factKey(ref);
				if (this.options.persistence && !this.knowledge.cells.has(key))
					persisted.push(
						deletedFact({
							key,
							resource: ref.resource,
							field: "relationship" in ref ? ref.relationship : ref.field,
							kind: "relationship" in ref ? "relationship" : "field",
							revision: this.knowledge.revision,
						}),
					);
			}
			for (const fact of invalidated) {
				const definition = this.definition(fact.resource);
				const permitted =
					fact.kind === "relationship"
						? definition.persistRelationship?.(fact.field, fact.identity)
						: definition.persist?.(fact.field, fact.value, fact.identity);
				persisted.push(permitted ? fact : deletedFact(fact));
			}
			for (const ref of batch.invalidateMemberships ?? []) {
				const withdrawn = withdrawMembership(
					this.knowledge,
					this.queries.states.values(),
					ref,
				);
				if (withdrawn) persistedMemberships.push(withdrawn);
				else if (this.options.persistence)
					persistedMemberships.push(
						deletedMembership({
							key: membershipKey(ref),
							resource: ref.resource,
							revision: this.knowledge.revision,
						}),
					);
			}
			if (
				(batch.facts?.length ?? 0) +
					(batch.memberships?.length ?? 0) +
					(batch.relationships?.length ?? 0) +
					(batch.invalidate?.length ?? 0) +
					(batch.invalidateMemberships?.length ?? 0) >
				0
			) {
				this.changed = true;
				this.knowledge.refreshCurrency();
				this.knowledge.rebuildRecords();
				this.acquisitions.evidence(
					new Set(
						[
							...(batch.facts ?? []),
							...(batch.relationships ?? []),
							...(batch.memberships ?? []),
							...(batch.invalidate ?? []),
							...(batch.invalidateMemberships ?? []),
						].map((value) => value.resource),
					),
				);
				if (changed.length > 0) {
					const controller = new AbortController();
					const context = this.context(controller.signal);
					for (const definition of this.definitions.values()) {
						const derived = definition.derive?.(changed, context);
						if (derived) this.observe(derived);
					}
				}
				this.rebuildEffective();
			}
			if (
				this.options.persistence &&
				(persisted.length || persistedMemberships.length)
			) {
				const write = this.ready.then(async () => {
					const facts = persisted
						.filter(
							(fact) =>
								fact.deleted ||
								this.knowledge.cells.get(fact.key)?.revision === fact.revision,
						)
						.map((fact) => ({ ...fact, revision: ++this.knowledge.revision }));
					const memberships = persistedMemberships
						.filter(
							(membership) =>
								membership.deleted ||
								this.knowledge.memberships.get(membership.key)?.revision ===
									membership.revision,
						)
						.map((membership) => ({
							...membership,
							revision: ++this.knowledge.revision,
						}));
					await this.options.persistence?.writeFacts(facts, memberships);
				});
				void this.persist(write);
			}
		});
	}

	setContinuity(ref: ContinuityRef, state: "live" | "interrupted"): void {
		if (this.closed || !this.knowledge.continuity.set(ref, state)) return;
		this.batch(() => {
			const changed = this.knowledge.refreshCurrency(ref);
			const resources = new Set(changed.map((value) => value.resource));
			for (const [key, membership] of this.knowledge.memberships) {
				const complete = membership.supports.some(
					(entry) =>
						entry.complete && !this.knowledge.supportCurrency([entry]).stale,
				);
				if (
					membership.complete === complete &&
					!membership.supports.some((support) =>
						this.knowledge.continuity.uses(support.liveness, ref),
					)
				)
					continue;
				this.knowledge.memberships.set(key, {
					...membership,
					complete,
					stale: this.knowledge.supportCurrency(membership.supports).stale,
					currencyRevision: ++this.knowledge.revision,
				});
				resources.add(membership.resource);
			}
			for (const query of this.queries.states.values())
				if (resources.has(query.descriptor.resource)) query.version++;
			this.changed = true;
			this.knowledge.rebuildRecords();
			this.rebuildEffective();
		});
	}

	event(resource: string, event: unknown): void {
		const controller = new AbortController();
		this.batch(() => {
			const observation = this.definitions
				.get(resource)
				?.event?.(event, this.context(controller.signal));
			if (observation) this.observe(observation);
		});
	}

	setAccess(update: AccessUpdate): void {
		if (this.closed) return;
		this.batch(() => {
			const previousContext = this.grants.contextId;
			const previousAccess = this.grants.snapshot();
			const previousBindings = this.grants.bindingsSnapshot();
			const revoked = this.grants.apply(update);
			if (previousAccess.revision === this.grants.snapshot().revision) {
				this.changed = true;
				return;
			}
			const bindings = this.grants.bindingsSnapshot();
			if (
				!equal(previousBindings, bindings) &&
				this.options.persistence?.writeAccessBindings
			)
				void this.persist(
					this.options.persistence.writeAccessBindings(bindings),
				);
			for (const state of this.queries.states.values()) state.version++;
			const changed: EvidenceRef[] = [];
			if (
				update.contextId !== undefined &&
				previousContext !== update.contextId &&
				update.retirePrevious !== false
			) {
				revoked.push(
					...this.activities.retireTransferAdmissions(previousContext),
				);
				for (const fact of this.restoration.quarantinedFacts)
					if (fact.contextId !== update.contextId)
						revoked.push(
							...fact.bases
								.flatMap(proofLeaves)
								.filter((basis) => !this.grants.independentProof(basis)),
						);
				this.restoration.quarantinedFacts =
					this.restoration.quarantinedFacts.filter(
						(fact) =>
							fact.contextId === update.contextId ||
							fact.bases.some((basis) => this.grants.independentProof(basis)),
					);
				this.restoration.quarantinedMemberships =
					this.restoration.quarantinedMemberships.filter(
						(membership) =>
							membership.contextId === update.contextId ||
							membership.bases.some((basis) =>
								this.grants.independentProof(basis),
							),
					);
			}
			if (revoked.length > 0)
				for (const state of this.queries.states.values()) state.issues = [];
			for (const [key, cell] of this.knowledge.cells) {
				const next = this.knowledge.prune(cell);
				if (!next) {
					this.knowledge.dropCell(key);
					this.knowledge.touched.add(key);
					changed.push(cellRef(cell));
				} else {
					if (!equal(next.supports, cell.supports)) changed.push(cellRef(cell));
					this.knowledge.putCell(next);
				}
			}
			for (const [key, membership] of this.knowledge.memberships) {
				const bases = this.grants
					.surviving(membership.bases)
					.map((basis) => this.grants.adopt(basis));
				if (bases.length === 0) this.knowledge.memberships.delete(key);
				else {
					const supports = membership.supports
						.map((support) => ({
							...support,
							bases: this.grants
								.surviving(support.bases)
								.map((basis) => this.grants.adopt(basis)),
						}))
						.filter((support) => support.bases.length > 0);
					this.knowledge.memberships.set(key, {
						...membership,
						bases,
						supports,
						stale: this.knowledge.supportCurrency(supports).stale,
						complete: supports.some(
							(entry) =>
								entry.complete &&
								!this.knowledge.supportCurrency([entry]).stale,
						),
					});
				}
			}
			this.knowledge.refreshCurrency();
			this.restoration.admitQuarantine();
			this.knowledge.revision++;
			this.changed = true;
			this.knowledge.rebuildRecords();
			const context = this.context(new AbortController().signal);
			for (const definition of this.definitions.values()) {
				const derived = definition.derive?.(changed, context);
				if (derived) this.observe(derived);
			}
			this.activities.accessChanged();
			this.rebuildEffective();
			if (revoked.length && this.options.persistence)
				void this.persist(this.options.persistence.revoke(revoked));
			void this.activities.recover(this.restoration.recoverable());
		});
	}
	updateAccess(update: AccessUpdate): void {
		this.setAccess(update);
	}
	access(scope: string): AccessState {
		return this.grants.state(scope);
	}
	accessSnapshot(): AccessSnapshot {
		return this.grants.snapshot();
	}
	revoke(scope: string): void {
		this.setAccess({ decisions: [{ scope, state: "denied" }] });
	}

	relationship(resource: string, identity: unknown, name: string) {
		return this.knowledge.relationship({
			resource,
			identity,
			relationship: name,
		});
	}
	membership(
		resource: string,
		scope?: unknown,
		where: Readonly<Values> = {},
	): KnownMembership | undefined {
		const membership = this.knowledge.memberships.get(
			`${resource}:${stableKey(scope)}:${stableKey(where)}`,
		);
		return membership && this.grants.allowsAny(membership.bases)
			? frozen({
					identities: structuredClone(membership.identities),
					complete: membership.complete,
				})
			: undefined;
	}
	private context(signal: AbortSignal): ResourceContext {
		const runtime = this;
		return createResourceContext(
			{
				grants: this.grants,
				get revision() {
					return runtime.knowledge.revision;
				},
				get closed() {
					return runtime.closed;
				},
				cells: this.knowledge.cells,
				records: this.knowledge.records,
				memberships: this.knowledge.memberships,
				relationship: (resource, identity, name) =>
					this.relationship(resource, identity, name),
				membership: (resource, scope, where) =>
					this.membership(resource, scope, where),
				invalidations: this.knowledge.invalidations,
				continuity: this.knowledge.continuity,
				disclosure: (ref) => this.knowledge.disclosure(ref),
				definition: (resource) => this.definition(resource),
				recordKey: (resource, identity) =>
					this.knowledge.recordKey(resource, identity),
				factKey: (ref) => this.knowledge.factKey(ref),
				setAccess: (update) => this.setAccess(update),
				observe: (batch, continuity) => this.observeEvidence(batch, continuity),
				batch: (work) => this.batch(work),
			},
			signal,
		);
	}

	readModelSnapshot(): ReadModelSnapshot {
		return this.readModel.snapshot();
	}
	peekQuery<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
	): QueryResult<T, I> | undefined {
		return this.queries.peek(descriptor);
	}
	watch<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
	): QueryHandle<T, I> {
		return this.queries.watch(descriptor);
	}
	read<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
		options?: { signal?: AbortSignal },
	): Promise<QueryResult<T, I>> {
		return this.queries.read(descriptor, options);
	}
	availability(command: CommandDescriptor): Availability {
		const availability = this.commandAvailability(command);
		const capacity = this.activities.capacityReason(command);
		const result =
			["available", "unknown"].includes(availability.state) && capacity
				? { state: "blocked" as const, reason: capacity }
				: availability;
		const definition = this.definitions.get(command.resource)?.commands?.[
			command.name
		];
		return definition?.transfer
			? {
					...result,
					execution: {
						lifetime: "owner",
						reason: this.options.transfers
							? "Browser continuation is established only after acceptance."
							: "Keep this application open until the transfer finishes.",
					},
				}
			: result;
	}
	private commandAvailability(command: CommandDescriptor): Availability {
		const definition = this.definitions.get(command.resource)?.commands?.[
			command.name
		];
		if (!definition)
			return { state: "unsupported", reason: "This command is not supported" };
		const requirement =
			typeof definition.access === "function"
				? definition.access(command)
				: definition.access;
		const permission = evaluateAccess(requirement, (scope) =>
			this.access(scope),
		);
		if (permission === "denied")
			return {
				state: "denied",
				reason: "Permission to perform this action was revoked",
			};
		const result = definition.availability?.(
			command,
			this.context(new AbortController().signal),
		);
		if (result) return result;
		if (permission === "unknown")
			return {
				state: "unknown",
				reason: "Permission has not been established",
			};
		return { state: "available" };
	}
	watchAvailability(command: CommandDescriptor): Watch<Availability> {
		let cached = this.availability(command);
		return {
			getSnapshot: () => {
				const value = this.availability(command);
				if (!equal(cached, value)) cached = value;
				return cached;
			},
			subscribe: (listener) => this.subscribe(listener),
		};
	}
	run<O extends ActionOutcome>(
		command: CommandDescriptor<unknown, O>,
		options?: { id?: string; origin?: string },
	): ActionHandle<O> {
		return this.batch(() =>
			this.activities.run(command as CommandDescriptor, options),
		) as ActionHandle<O>;
	}
	action(id: string): Watch<ActionSnapshot | undefined> {
		return this.activities.watch(id);
	}
	listActivities(): readonly ActionSnapshot[] {
		return this.activities.list();
	}
	subscribeActivities(listener: () => void): () => void {
		return this.activities.subscribe(listener);
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	prepareEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		descriptor: EditDescriptor<T, unknown, O>,
	): Promise<PreparedEdit<T, O>> {
		return this.edits.prepare(descriptor);
	}
	saveEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		prepared: PreparedEdit<T, O>,
		values: T,
		options?: { id?: string; origin?: string },
	): ActionHandle<CommandResult<O>> {
		return this.edits.save(prepared, values, options);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.acquisitions.close();
		this.queries.close();
		this.activities.close();
		this.grants.close();
		this.listeners.clear();
		this.knowledge.close();
		this.readModel.close();
		this.projectionModel = undefined;
		this.queryProjection.changed([], true);
		this.restoration.quarantinedFacts = [];
		this.restoration.quarantinedMemberships = [];
		this.restoration.pendingRecovery = [];
		this.presentation.close();
		this.options.persistence?.close();
	}
}

/** Create one owner runtime. Await ready for restoration; persistence is optional and does not authorize protected data by itself. */
export function createRuntime(options: RuntimeOptions): Runtime {
	return new Runtime(options);
}
