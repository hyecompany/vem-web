// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { CommandDescriptor } from "../types.js";
import type { ActionHost, Entry } from "./entry.js";

export function capacityReason(
	command: CommandDescriptor,
	entries: Iterable<Entry>,
	host: ActionHost,
): string | undefined {
	if (host.definition(command)?.execution === "control") {
		return [...entries].some(
			(entry) =>
				entry.definition.execution === "control" &&
				entry.command.resource === command.resource &&
				entry.command.name === command.name &&
				entry.snapshot.phase !== "settled",
		)
			? "This control command is already running"
			: undefined;
	}
	const mutations = [...entries].filter(
		(entry) => entry.definition.execution !== "control",
	);
	if (
		mutations.filter(
			(entry) =>
				entry.snapshot.phase !== "settled" ||
				entry.snapshot.outcome?.kind === "unknown",
		).length >= host.maxUnresolvedActions
	)
		return "The unresolved action limit has been reached; investigate existing work before starting more";
	if (
		mutations.filter(
			(entry) => entry.snapshot.phase === "preparing" && !entry.recovered,
		).length >= host.maxPendingActions
	)
		return "The pending action queue is full";
	return undefined;
}

export class ActionAdmission {
	private activeSubmissions = 0;
	private activeRecoveries = 0;
	private admissionQueue: {
		entry: Entry;
		recovery: boolean;
		resolve(release: () => void): void;
		reject(error: Error): void;
		abort(): void;
	}[] = [];

	constructor(
		private limit: number,
		private isClosed: () => boolean,
	) {}
	acquire(entry: Entry, recovery: boolean): Promise<() => void> {
		return new Promise((resolve, reject) => {
			const queued = {
				entry,
				recovery,
				resolve,
				reject,
				abort: () => {
					this.admissionQueue = this.admissionQueue.filter(
						(item) => item !== queued,
					);
					reject(new Error("Action admission was canceled"));
				},
			};
			if (
				entry.controller.signal.aborted ||
				this.isClosed() ||
				entry.forgotten
			) {
				queued.abort();
				return;
			}
			entry.controller.signal.addEventListener("abort", queued.abort, {
				once: true,
			});
			this.admissionQueue.push(queued);
			this.pumpAdmissions();
		});
	}
	private pumpAdmissions(): void {
		for (const queued of [...this.admissionQueue]) {
			if (this.isClosed()) return;
			const active = queued.recovery
				? this.activeRecoveries
				: this.activeSubmissions;
			if (active >= this.limit) continue;
			this.admissionQueue = this.admissionQueue.filter(
				(item) => item !== queued,
			);
			queued.entry.controller.signal.removeEventListener("abort", queued.abort);
			if (queued.recovery) this.activeRecoveries++;
			else this.activeSubmissions++;
			let released = false;
			queued.resolve(() => {
				if (released) return;
				released = true;
				if (queued.recovery) this.activeRecoveries--;
				else this.activeSubmissions--;
				this.pumpAdmissions();
			});
		}
	}

	close(): void {
		this.admissionQueue = [];
	}
}
