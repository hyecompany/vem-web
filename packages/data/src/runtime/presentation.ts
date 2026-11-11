// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { createCollection } from "@tanstack/db";
import type { AccessRegistry } from "../access.js";
import type { ActionRegistry } from "../actions.js";
import { freezeValue } from "../descriptors.js";
import type {
	DisclosureBasis,
	DisclosureProof,
	FactRef,
	FieldInfo,
	KnownRecord,
	ObservationBatch,
	ResourceContext,
	ResourceDefinition,
} from "../types.js";
import { equal, frozen } from "../values.js";
import type { EffectiveRecord } from "./state.js";

interface PresentationHost {
	activities: ActionRegistry;
	grants: AccessRegistry;
	records: ReadonlyMap<string, KnownRecord>;
	definitions: ReadonlyMap<string, ResourceDefinition>;
	dirtyEffective: Set<string>;
	recordKey(resource: string, identity: unknown): string;
	basis(refs: readonly DisclosureBasis[] | undefined): DisclosureProof[];
	context(signal: AbortSignal): ResourceContext;
}
export class PresentationIndex {
	readonly effective = new Map<string, EffectiveRecord>();
	readonly exportedRecords = new Set<string>();
	readonly aliases = new Map<string, string>();
	projectionKeys = new Set<string>();
	readonly derivedProjectionKeys = new Set<string>();
	private readonly source;
	private sourceSync!: {
		begin(): void;
		write(message: {
			type: "insert" | "update" | "delete";
			value: EffectiveRecord;
		}): void;
		commit(): unknown;
	};
	constructor(private readonly host: PresentationHost) {
		this.source = createCollection<EffectiveRecord, string>({
			id: `vem-${globalThis.crypto.randomUUID()}`,
			getKey: (record) => record.key,
			sync: {
				rowUpdateMode: "full",
				sync: (sync) => {
					this.sourceSync = sync;
					sync.begin();
					sync.commit();
					sync.markReady();
				},
			},
			startSync: true,
		});
	}
	get(key: string): EffectiveRecord | undefined {
		return this.source.get(key);
	}
	*records(resource: string): Iterable<EffectiveRecord> {
		for (const record of this.source.values())
			if (record.resource === resource) yield record;
	}
	update(): boolean {
		const next = new Map<string, EffectiveRecord>();
		const projections = this.host.activities.projections();
		const keys = new Set(this.host.dirtyEffective);
		for (const key of this.projectionKeys) keys.add(key);
		for (const key of this.derivedProjectionKeys) keys.add(key);
		this.derivedProjectionKeys.clear();
		this.projectionKeys = new Set(
			projections.map(({ action, projection }) =>
				projection.identity === undefined
					? `proposal:${action.id}:${projection.resource}`
					: this.host.recordKey(projection.resource, projection.identity),
			),
		);
		for (const key of this.projectionKeys) keys.add(key);
		for (const key of keys) {
			const record = this.host.records.get(key);
			if (record && record.presence !== "absent")
				next.set(key, {
					...record,
					rowKey: this.aliases.get(key) ?? key,
					actionIds: [],
				});
		}
		for (const { action, projection } of projections) {
			if (
				projection.basis &&
				!this.host.grants.allowsAny(this.host.basis(projection.basis))
			)
				continue;
			const identity = projection.identity;
			const key =
				identity === undefined
					? `proposal:${action.id}:${projection.resource}`
					: this.host.recordKey(projection.resource, identity);
			const previousProposal = `proposal:${action.id}:${projection.resource}`;
			if (
				identity !== undefined &&
				projection.kind === "create" &&
				this.effective.has(previousProposal)
			)
				this.aliases.set(key, previousProposal);
			let record = next.get(key);
			if (!record) {
				if (projection.kind !== "create") continue;
				const rowKey = `proposal:${action.id}:${projection.resource}`;
				if (identity !== undefined) this.aliases.set(key, rowKey);
				record = {
					key,
					rowKey,
					resource: projection.resource,
					identity,
					proposal: action.id,
					requested: projection.requested,
					presence: "unknown",
					values: {},
					fields: {},
					actionIds: [],
				};
			}
			const values = { ...record.values },
				fields = { ...record.fields };
			const observedCreation =
				projection.kind === "create" && record.presence === "present";
			if (!observedCreation && projection.kind !== "delete")
				for (const [field, value] of Object.entries(projection.values)) {
					values[field] = freezeValue(structuredClone(value));
					fields[field] = {
						source: "proposed",
						liveness: "snapshot",
						actionIds: [
							...new Set([...(fields[field]?.actionIds ?? []), action.id]),
						],
					};
				}
			next.set(key, {
				...record,
				rowKey: this.aliases.get(key) ?? record.rowKey,
				values: frozen(values),
				fields: frozen(fields),
				actionIds: [...new Set([...record.actionIds, action.id])],
			});
		}
		if (projections.length > 0) {
			const get = (resource: string, identity: unknown) => {
				const key = this.host.recordKey(resource, identity);
				return (
					next.get(key) ?? (keys.has(key) ? undefined : this.effective.get(key))
				);
			};
			let changed: FactRef[] = projections.flatMap(({ projection }) =>
				projection.identity === undefined
					? []
					: Object.keys(projection.values).map((field) => ({
							resource: projection.resource,
							identity: projection.identity,
							field,
						})),
			);
			const base = this.host.context(new AbortController().signal);
			for (
				let pass = 0;
				changed.length > 0 && pass <= this.host.definitions.size;
				pass++
			) {
				const batches: ObservationBatch[] = [];
				const context: ResourceContext = {
					...base,
					get,
					records: (resource) => {
						const records = new Map(
							[...this.effective].filter(
								([key, record]) =>
									record.resource === resource && !keys.has(key),
							),
						);
						for (const [key, record] of next)
							if (record.resource === resource) records.set(key, record);
						return [...records.values()];
					},
					observe: (batch) => {
						batches.push(batch);
					},
					grant: () => {
						throw new Error("Derivations cannot change access");
					},
				};
				for (const definition of this.host.definitions.values()) {
					const derived = definition.derive?.(changed, context);
					if (derived) batches.push(derived);
				}
				changed = [];
				for (const fact of batches.flatMap((batch) => batch.facts ?? [])) {
					const dependencies = (fact.dependsOn ?? []).map((ref) =>
						"relationship" in ref
							? (() => {
									const relation = base.relationship(
										ref.resource,
										ref.identity,
										ref.relationship,
									);
									return relation
										? {
												source: "observed" as const,
												liveness: relation.liveness,
												stale: relation.stale,
												actionIds: [],
											}
										: undefined;
								})()
							: get(ref.resource, ref.identity)?.fields[ref.field],
					);
					if (
						dependencies.length === 0 ||
						dependencies.some((field) => field === undefined || field.stale)
					)
						continue;
					const actionIds = [
						...new Set(dependencies.flatMap((field) => field?.actionIds ?? [])),
					];
					if (actionIds.length === 0) continue;
					const basis = fact.certifiedBasis ?? fact.basis;
					if (basis && !this.host.grants.allowsAny(this.host.basis(basis)))
						continue;
					const key = this.host.recordKey(fact.resource, fact.identity);
					const current = get(fact.resource, fact.identity);
					if (!current) continue;
					let modified = false;
					const values = { ...current.values },
						fields = { ...current.fields };
					for (const [field, value] of Object.entries(fact.values ?? {})) {
						const provenance: FieldInfo = {
							source: "proposed",
							liveness: "snapshot",
							actionIds,
						};
						if (equal(values[field], value) && equal(fields[field], provenance))
							continue;
						values[field] = freezeValue(structuredClone(value));
						fields[field] = provenance;
						modified = true;
						changed.push({
							resource: fact.resource,
							identity: fact.identity,
							field,
						});
					}
					if (modified) {
						keys.add(key);
						this.derivedProjectionKeys.add(key);
						next.set(key, {
							...current,
							values: frozen(values),
							fields: frozen(fields),
							actionIds: [...new Set([...current.actionIds, ...actionIds])],
						});
					}
				}
			}
		}
		const writes: {
			type: "insert" | "update" | "delete";
			value: EffectiveRecord;
		}[] = [];
		for (const key of keys) {
			const previous = this.effective.get(key);
			if (previous && !next.has(key))
				writes.push({ type: "delete", value: previous });
		}
		for (const [key, value] of next)
			if (!equal(value, this.effective.get(key)))
				writes.push({
					type: this.effective.has(key) ? "update" : "insert",
					value: frozen(value),
				});
		this.host.dirtyEffective.clear();
		if (writes.length === 0) return false;
		this.sourceSync.begin();
		for (const write of writes) {
			this.sourceSync.write(write);
			this.exportedRecords.add(write.value.key);
			if (write.type === "delete") this.effective.delete(write.value.key);
			else this.effective.set(write.value.key, write.value);
		}
		if (this.sourceSync.commit() !== true)
			throw new Error(
				"The pinned projection engine did not synchronously publish accepted knowledge",
			);
		return true;
	}

	close(): void {
		this.aliases.clear();
		this.effective.clear();
		this.exportedRecords.clear();
		this.projectionKeys.clear();
		this.derivedProjectionKeys.clear();
		void this.source.cleanup();
	}
}
