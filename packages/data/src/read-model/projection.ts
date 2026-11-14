// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { emptyResult } from "../protocol.js";
import type {
	AccessSnapshot,
	ActionSnapshot,
	KnownRecord,
	QueryDescriptor,
	QueryResult,
	ResourceReadDefinition,
} from "../types.js";
import { frozen } from "../values.js";
import { readModelChanges } from "./publication.js";
import { QueryProjection } from "./query-projector.js";
import type {
	QueryAcquisitionState,
	ReadModelEffectiveRecord,
	ReadModelFact,
	ReadModelRecord,
	ReadModelSnapshot,
} from "./types.js";

export class ReadModelProjection {
	private readonly definitions: ReadonlyMap<string, ResourceReadDefinition>;
	private readonly records = new Map<string, KnownRecord>();
	private readonly effective = new Map<string, ReadModelEffectiveRecord>();
	private readonly effectiveResources = new Map<
		string,
		Map<string, ReadModelEffectiveRecord>
	>();
	private readonly resourceRecords = new Map<string, Set<string>>();
	private readonly cells = new Map<string, ReadModelFact>();
	private readonly publishedRecords = new Map<string, ReadModelRecord>();
	private readonly projector: QueryProjection;
	private snapshot?: ReadModelSnapshot;
	private access: AccessSnapshot = { contextId: "", revision: 0, scopes: {} };
	private activities: readonly ActionSnapshot[] = [];
	constructor(definitions: readonly ResourceReadDefinition[]) {
		this.definitions = new Map(
			definitions.map((definition) => [definition.name, definition]),
		);
		if (this.definitions.size !== definitions.length)
			throw new Error("Read definitions must have unique resource names");
		this.projector = new QueryProjection({
			definition: (resource) => this.definition(resource),
			recordKey: (resource, identity) => this.recordKey(resource, identity),
			factKey: (ref) =>
				`${this.recordKey(ref.resource, ref.identity)}:${JSON.stringify(ref.field)}`,
			access: (scope) => this.access.scopes[scope]?.state ?? "unknown",
			revision: () => this.snapshot?.revision ?? 0,
			records: this.records,
			identityTransitions: () => this.snapshot?.identityTransitions ?? [],
			effective: (key) => this.effective.get(key),
			effectiveRecords: (resource) =>
				this.effectiveResources.get(resource)?.values() ?? [],
			resourceRecords: this.resourceRecords,
			memberships: () => this.snapshot?.memberships ?? [],
			cells: this.cells,
			invalidations: new Map(),
			activities: () => this.activities,
		});
	}
	supports(resource: string): boolean {
		return this.definitions.has(resource);
	}
	private definition(resource: string): ResourceReadDefinition {
		const definition = this.definitions.get(resource);
		if (!definition) throw new Error(`Unknown read resource ${resource}`);
		return definition;
	}
	private recordKey(resource: string, identity: unknown): string {
		return `${resource}:${this.definition(resource).key?.(identity) ?? stableKey(identity)}`;
	}
	setSnapshot(
		snapshot: ReadModelSnapshot,
		access: AccessSnapshot,
		activities: readonly ActionSnapshot[],
	): void {
		const previous = this.snapshot;
		const accessChanged =
			this.access.contextId !== access.contextId ||
			this.access.revision !== access.revision;
		const changes = previous && readModelChanges(previous, snapshot);
		const changed = new Set<string>();
		this.access = access;
		this.activities = activities;
		if (changes) {
			for (const key of changes.records.remove) {
				changed.add(key);
				this.replaceRecord(this.publishedRecords.get(key));
			}
			for (const record of changes.records.upsert) {
				changed.add(record.key);
				this.replaceRecord(this.publishedRecords.get(record.key), record);
			}
		} else if (previous?.records !== snapshot.records) {
			const keys = new Set(snapshot.records.map((record) => record.key));
			for (const record of this.publishedRecords.values())
				if (!keys.has(record.key)) {
					changed.add(record.key);
					this.replaceRecord(record);
				}
			for (const record of snapshot.records) {
				const prior = this.publishedRecords.get(record.key);
				if (prior !== record) {
					changed.add(record.key);
					this.replaceRecord(prior, record);
				}
			}
		}
		this.snapshot = snapshot;
		this.projector.changed(
			changed,
			accessChanged || previous?.memberships !== snapshot.memberships,
		);
	}

	private replaceRecord(
		previous?: ReadModelRecord,
		next?: ReadModelRecord,
	): void {
		if (previous) {
			if (!next) this.publishedRecords.delete(previous.key);
			if (
				previous.confirmed &&
				previous.confirmed.resource !== next?.confirmed?.resource
			) {
				this.records.delete(previous.key);
				const keys = this.resourceRecords.get(previous.confirmed.resource);
				keys?.delete(previous.key);
				if (keys?.size === 0)
					this.resourceRecords.delete(previous.confirmed.resource);
			}
			if (
				previous.effective &&
				previous.effective.resource !== next?.effective?.resource
			) {
				this.effective.delete(previous.key);
				const values = this.effectiveResources.get(previous.effective.resource);
				values?.delete(previous.key);
				if (values?.size === 0)
					this.effectiveResources.delete(previous.effective.resource);
			}
			for (const field of Object.keys(previous.facts))
				this.cells.delete(`${previous.key}:${JSON.stringify(field)}`);
		}
		if (!next) return;
		this.publishedRecords.set(next.key, next);
		if (next.confirmed) {
			this.records.set(next.key, next.confirmed);
			const keys =
				this.resourceRecords.get(next.confirmed.resource) ?? new Set<string>();
			keys.add(next.key);
			this.resourceRecords.set(next.confirmed.resource, keys);
		}
		if (next.effective) {
			this.effective.set(next.key, next.effective);
			const values =
				this.effectiveResources.get(next.effective.resource) ??
				new Map<string, ReadModelEffectiveRecord>();
			values.set(next.key, next.effective);
			this.effectiveResources.set(next.effective.resource, values);
		}
		for (const [field, fact] of Object.entries(next.facts))
			this.cells.set(`${next.key}:${JSON.stringify(field)}`, fact);
	}

	project<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
		status?: QueryAcquisitionState,
	): QueryResult<T, I> {
		const value = this.projector.snapshot({
			descriptor: descriptor as QueryDescriptor,
			version: 0,
			attempted: status?.settled ? 0 : -1,
			forced: -1,
			fetching: status?.fetching ? 1 : 0,
			revalidating: status?.revalidating ?? false,
			issues: [...(status?.issues ?? [])],
			snapshot: emptyResult(),
		});
		return frozen(value) as QueryResult<T, I>;
	}
}
