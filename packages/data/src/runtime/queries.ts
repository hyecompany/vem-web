// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { QueryProjection } from "../read-model/query-projector.js";
import type {
	QueryDescriptor,
	QueryHandle,
	QueryResult,
	QueryWatchOptions,
} from "../types.js";
import { equal, frozen } from "../values.js";
import type { QueryState } from "./state.js";

interface QueryHost {
	readonly closed: boolean;
	projection: QueryProjection;
	supports(resource: string): boolean;
	changed(): void;
	publish(): void;
	schedule(): void;
	notify(listener: () => void): void;
	released(): void;
}
export class QueryRegistry {
	readonly states = new Map<string, QueryState>();
	private readonly readWaiters = new Set<(error: Error) => void>();
	constructor(
		private readonly host: QueryHost,
		private readonly maxInactive: number,
	) {}
	peek<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
	): QueryResult<T, I> | undefined {
		return this.states.get(stableKey(descriptor))?.snapshot as
			| QueryResult<T, I>
			| undefined;
	}
	watch<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
		options: QueryWatchOptions = {},
	): QueryHandle<T, I> {
		if (this.host.closed) throw new Error("Runtime is closed");
		if (!this.host.supports(descriptor.resource))
			throw new Error(`Unknown resource ${descriptor.resource}`);
		if (
			descriptor.sample &&
			(!Number.isFinite(descriptor.sample.intervalMs) ||
				descriptor.sample.intervalMs < 100)
		)
			throw new Error("Explicit sampling interval must be at least 100ms");
		const acquire = options.acquire !== false;
		const key = stableKey(descriptor);
		let current: QueryState | undefined;
		const ensure = (): QueryState => {
			if (this.host.closed) throw new Error("Runtime is closed");
			let state = this.states.get(key);
			if (!state) {
				state = {
					key,
					descriptor: descriptor as QueryDescriptor,
					listeners: new Set(),
					snapshot: undefined as unknown as QueryResult,
					version: 0,
					attempted: -1,
					forced: -1,
					fetching: 0,
					users: 0,
					demands: 0,
					waiters: 0,
					issues: [],
					active: false,
				};
				state.snapshot = frozen(this.host.projection.snapshot(state));
				if (
					current &&
					equal(
						{ ...current.snapshot, revision: 0 },
						{ ...state.snapshot, revision: 0 },
					)
				)
					state.snapshot = current.snapshot;
				this.states.set(key, state);
			}
			current = state;
			return state;
		};
		this.deactivate(ensure());
		let disposed = false;
		const callbacks = new Set<() => void>();
		let passiveSnapshot: QueryResult | undefined;
		const snapshot = (): QueryResult<T, I> => {
			if (disposed) throw new Error("Query handle was disposed");
			const state = ensure();
			if (acquire || state.active || state.snapshot.settled)
				return state.snapshot as QueryResult<T, I>;
			const value = { ...state.snapshot, settled: true };
			if (!equal(passiveSnapshot, value)) passiveSnapshot = frozen(value);
			return passiveSnapshot as QueryResult<T, I>;
		};
		return {
			getSnapshot: snapshot,
			subscribe: (listener) => {
				if (disposed) throw new Error("Query handle was disposed");
				const current = ensure();
				let previous = snapshot();
				const registered = () => {
					if (disposed) return;
					const next = snapshot();
					if (next === previous) return;
					previous = next;
					listener();
				};
				if (callbacks.size === 0) {
					current.users++;
					if (acquire) current.demands++;
				}
				callbacks.add(registered);
				current.listeners.add(registered);
				const wasActive = current.active;
				current.active = current.demands + current.waiters > 0;
				if (acquire && descriptor.sample && current.timer === undefined) {
					current.timer = setInterval(() => {
						current.forced = ++current.version;
						this.host.changed();
						this.host.publish();
						this.host.schedule();
					}, descriptor.sample.intervalMs);
				}
				if (acquire) {
					this.host.changed();
					this.host.publish();
					this.host.schedule();
					if (wasActive !== current.active)
						for (const callback of current.listeners)
							this.host.notify(callback);
				}
				return () => {
					if (!callbacks.delete(registered)) return;
					current.listeners.delete(registered);
					if (callbacks.size === 0) {
						current.users--;
						if (acquire) current.demands--;
					}
					this.deactivate(current);
				};
			},
			retry: () => {
				if (disposed) throw new Error("Query handle was disposed");
				return this.retry(ensure()) as Promise<QueryResult<T, I>>;
			},
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (!current) return;
				if (callbacks.size > 0) {
					current.users--;
					if (acquire) current.demands--;
				}
				for (const callback of callbacks) current.listeners.delete(callback);
				callbacks.clear();
				this.deactivate(current);
			},
		};
	}
	private deactivate(state: QueryState): void {
		const wasActive = state.active;
		state.active = state.demands + state.waiters > 0;
		if (state.demands === 0 && state.timer !== undefined) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
		this.trimInactive();
		if (wasActive !== state.active) {
			this.host.changed();
			this.host.publish();
			this.host.schedule();
			this.host.released();
			for (const callback of state.listeners) this.host.notify(callback);
		}
	}
	trimInactive(): void {
		const inactive = [...this.states.values()].filter(
			(query) =>
				!query.active &&
				query.users === 0 &&
				query.listeners.size === 0 &&
				query.fetching === 0,
		);
		for (const query of inactive.slice(
			0,
			Math.max(0, inactive.length - this.maxInactive),
		)) {
			this.states.delete(query.key);
		}
	}
	async retry(state: QueryState): Promise<QueryResult> {
		if (!this.host.projection.needs(state))
			return state.fetching > 0 ? this.wait(state) : state.snapshot;
		state.forced = ++state.version;
		state.issues = [];
		state.failures = undefined;
		state.active = true;
		state.waiters++;
		this.host.changed();
		this.host.publish();
		this.host.schedule();
		return this.wait(state, undefined, true);
	}
	private wait(
		state: QueryState,
		signal?: AbortSignal,
		reserved = false,
	): Promise<QueryResult> {
		if (!reserved) state.waiters++;
		state.active = true;
		return new Promise((resolve, reject) => {
			let finished = false;
			const stopped = (error: Error) => {
				cleanup();
				reject(error);
			};
			const done = () => {
				if (finished) return;
				if (signal?.aborted) {
					cleanup();
					reject(signal.reason ?? new Error("Read canceled"));
				} else if (state.snapshot.settled) {
					cleanup();
					resolve(state.snapshot);
				}
			};
			const cleanup = () => {
				if (finished) return;
				finished = true;
				this.readWaiters.delete(stopped);
				state.listeners.delete(done);
				state.waiters--;
				signal?.removeEventListener("abort", done);
				this.deactivate(state);
			};
			this.readWaiters.add(stopped);
			state.listeners.add(done);
			signal?.addEventListener("abort", done, { once: true });
			done();
		});
	}
	async read<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
		options: { signal?: AbortSignal } = {},
	): Promise<QueryResult<T, I>> {
		const handle = this.watch(descriptor);
		const unsubscribe = handle.subscribe(() => undefined);
		try {
			const state = this.states.get(stableKey(descriptor));
			if (!state) throw new Error("The query was disposed before reading");
			return (await this.wait(state, options.signal)) as QueryResult<T, I>;
		} finally {
			unsubscribe();
			handle.dispose();
		}
	}
	close(): void {
		for (const reject of [...this.readWaiters])
			reject(new Error("Runtime closed"));
		for (const state of this.states.values()) {
			if (state.timer !== undefined) clearInterval(state.timer);
			state.listeners.clear();
		}
		this.states.clear();
	}
}
