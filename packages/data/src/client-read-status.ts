// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "./descriptors.js";
import { idleReadStatus, type ReadStatusDelta } from "./protocol.js";
import type { QueryDescriptor, ReadStatus, ReadStatusHandle } from "./types.js";
import { equal } from "./values.js";

type Listener = () => void;
interface Entry {
	value: ReadStatus;
	listeners: Set<Listener>;
}
interface StatusHost {
	send(message: unknown): void;
	retry(query: QueryDescriptor): Promise<void>;
}

/** Tab-side projections of owner-computed work; observing never registers read demand. */
export class BrowserReadStatuses {
	readonly #entries = new Map<string, Entry>();
	#failure?: ReadStatus;
	constructor(private readonly host: StatusHost) {}

	apply(updates: readonly ReadStatusDelta[], reset: boolean): Set<Listener> {
		const notify = new Set<Listener>();
		const incoming = new Map(updates.map(({ id, status }) => [id, status]));
		for (const [id, entry] of this.#entries) {
			const next = incoming.get(id) ?? (reset ? idleReadStatus : entry.value);
			if (equal(entry.value, next)) continue;
			entry.value = next;
			for (const listener of entry.listeners) notify.add(listener);
		}
		return notify;
	}

	fail(error: Error): Set<Listener> {
		this.#failure = {
			...idleReadStatus,
			issues: [{ kind: "read", message: error.message }],
		};
		return this.apply(
			[...this.#entries.keys()].map((id) => ({
				id,
				status: this.#failure as ReadStatus,
			})),
			true,
		);
	}

	watch(query: QueryDescriptor): ReadStatusHandle {
		const id = stableKey(query);
		const owned = new Set<() => void>();
		return {
			getSnapshot: () =>
				this.#entries.get(id)?.value ?? this.#failure ?? idleReadStatus,
			subscribe: (listener) => {
				let entry = this.#entries.get(id);
				if (!entry) {
					entry = {
						value: this.#failure ?? idleReadStatus,
						listeners: new Set(),
					};
					this.#entries.set(id, entry);
					this.host.send({ type: "watch-read-status", id, query });
				}
				const current = entry;
				const registered = () => listener();
				current.listeners.add(registered);
				const release = () => {
					if (!owned.delete(release)) return;
					current.listeners.delete(registered);
					if (current.listeners.size > 0 || this.#entries.get(id) !== current)
						return;
					this.#entries.delete(id);
					this.host.send({ type: "unwatch-read-status", id });
				};
				owned.add(release);
				return release;
			},
			retry: () => this.host.retry(query),
			dispose: () => {
				for (const release of owned) release();
			},
		};
	}
}
