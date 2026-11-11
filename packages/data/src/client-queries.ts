// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "./descriptors.js";
import type { QueryDelta } from "./protocol.js";
import { ReadModelProjection } from "./read-model/projection.js";
import { emptyReadModel } from "./read-model/publication.js";
import type {
	QueryAcquisitionState,
	ReadModelSnapshot,
} from "./read-model/types.js";
import type {
	AccessSnapshot,
	ActionSnapshot,
	QueryDescriptor,
	QueryHandle,
	QueryResult,
	ResourceReadDefinition,
} from "./types.js";
import { equal } from "./values.js";

type Listener = () => void;
interface QueryEntry {
	descriptor: QueryDescriptor;
	status?: QueryAcquisitionState;
	value?: QueryResult;
	projected?: QueryResult;
	listeners: Set<Listener>;
	bound: boolean;
}
interface QueryHost {
	send(message: unknown): void;
	retry<T extends object, I>(
		query: QueryDescriptor<T, I>,
	): Promise<QueryResult<T, I>>;
}

export class BrowserQueries {
	readonly #projection: ReadModelProjection;
	readonly #entries = new Map<string, QueryEntry>();
	#snapshot = emptyReadModel();
	#generation = 0;
	#activities: readonly ActionSnapshot[] = [];
	#error?: Error;
	#synchronizing = false;
	constructor(
		definitions: readonly ResourceReadDefinition[],
		private readonly host: QueryHost,
		private readonly maxInactive: number,
	) {
		this.#projection = new ReadModelProjection(definitions);
	}

	#project<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
		status?: QueryAcquisitionState,
	): QueryResult<T, I> {
		return this.#projection.project(
			descriptor,
			this.#error
				? {
						revalidating: false,
						fetching: false,
						settled: true,
						issues: [{ kind: "read", message: this.#error.message }],
					}
				: this.#synchronizing
					? {
							revalidating: false,
							fetching: false,
							settled: false,
							issues: [
								{
									kind: "read",
									message:
										"Resynchronizing the shared data snapshot after an access change",
								},
							],
						}
					: status,
		);
	}

	apply(
		snapshot: ReadModelSnapshot,
		access: AccessSnapshot,
		activities: readonly ActionSnapshot[],
		updates: readonly QueryDelta[],
		reset: boolean,
		accessChanged: boolean,
		synchronizing = false,
		forgotten: readonly string[] = [],
	): Set<Listener> {
		const modelChanged = snapshot !== this.#snapshot;
		const activitiesChanged = !equal(activities, this.#activities);
		const contextChanged =
			modelChanged ||
			accessChanged ||
			activitiesChanged ||
			synchronizing !== this.#synchronizing;
		this.#synchronizing = synchronizing;
		this.#activities = activities;
		this.#snapshot = snapshot;
		this.#projection.setSnapshot(snapshot, access, activities);
		const changed = new Set<QueryEntry>();
		for (const entry of this.#entries.values())
			if (reset || accessChanged) {
				if (entry.status) changed.add(entry);
				entry.status = undefined;
			}
		for (const id of forgotten) {
			const entry = this.#entries.get(id);
			if (entry?.status) {
				entry.status = undefined;
				changed.add(entry);
			}
		}
		for (const update of updates) {
			const entry = this.#entries.get(update.id);
			if (entry && !equal(entry.status, update.status)) {
				entry.status = update.status;
				changed.add(entry);
			}
		}
		if (contextChanged || changed.size > 0) this.#generation++;
		return this.#publish(contextChanged ? this.#entries.values() : changed);
	}

	fail(
		error: Error,
		access: AccessSnapshot,
		activities: readonly ActionSnapshot[],
	): Set<Listener> {
		this.#error = error;
		this.#projection.setSnapshot(this.#snapshot, access, activities);
		this.#generation++;
		return this.#publish();
	}

	#publish(
		entries: Iterable<QueryEntry> = this.#entries.values(),
	): Set<Listener> {
		const notify = new Set<Listener>();
		for (const entry of entries) {
			if (!entry.bound) {
				entry.value = undefined;
				entry.projected = undefined;
				continue;
			}
			const next = this.#project(entry.descriptor, entry.status);
			if (next === entry.projected) continue;
			entry.projected = next;
			if (
				entry.value &&
				equal({ ...entry.value, revision: 0 }, { ...next, revision: 0 })
			)
				continue;
			entry.value = next;
			for (const listener of entry.listeners) notify.add(listener);
		}
		return notify;
	}

	#trim(): void {
		const inactive = [...this.#entries].filter(([, entry]) => !entry.bound);
		for (const [id] of inactive.slice(
			0,
			Math.max(0, inactive.length - this.maxInactive),
		)) {
			this.#entries.delete(id);
			this.host.send({ type: "forget-query", id });
		}
	}

	watch<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
	): QueryHandle<T, I> {
		if (!this.#projection.supports(descriptor.resource))
			throw new Error(
				`No read definition was configured for ${descriptor.resource}. Pass its ResourceReadDefinition when connecting the browser client.`,
			);
		const id = stableKey(descriptor);
		const owned = new Set<() => void>();
		let generation = -1;
		let snapshot: QueryResult<T, I> | undefined;
		let projected: QueryResult<T, I> | undefined;
		const getSnapshot = (): QueryResult<T, I> => {
			const entry = this.#entries.get(id);
			if (entry) {
				if (!entry.value) {
					entry.projected = this.#project(entry.descriptor, entry.status);
					entry.value = entry.projected;
				}
				return entry.value as QueryResult<T, I>;
			}
			if (generation !== this.#generation || !snapshot) {
				const next = this.#project(descriptor);
				if (
					!snapshot ||
					(next !== projected &&
						!equal({ ...snapshot, revision: 0 }, { ...next, revision: 0 }))
				)
					snapshot = next;
				projected = next;
				generation = this.#generation;
			}
			return snapshot;
		};
		return {
			getSnapshot,
			subscribe: (listener) => {
				let entry = this.#entries.get(id);
				if (!entry) {
					entry = {
						descriptor: descriptor as QueryDescriptor,
						value: getSnapshot(),
						listeners: new Set(),
						bound: false,
					};
					this.#entries.set(id, entry);
				}
				snapshot = undefined;
				projected = undefined;
				generation = -1;
				const registered = () => listener();
				entry.listeners.add(registered);
				if (!entry.bound) {
					entry.bound = true;
					this.host.send({ type: "watch", id, query: descriptor });
				}
				const current = entry;
				const release = () => {
					if (!owned.delete(release)) return;
					current.listeners.delete(registered);
					if (
						current.listeners.size === 0 &&
						this.#entries.get(id) === current
					) {
						current.bound = false;
						this.#entries.delete(id);
						this.#entries.set(id, current);
						this.host.send({ type: "unwatch", id, query: descriptor });
						this.#trim();
					}
				};
				owned.add(release);
				return release;
			},
			retry: () => this.host.retry(descriptor),
			dispose: () => {
				for (const release of owned) release();
			},
		};
	}
}
