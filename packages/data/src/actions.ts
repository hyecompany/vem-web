// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { mapProof, proofLeaves } from "./access-proofs.js";
import { ActionAdmission, capacityReason } from "./actions/admission.js";
import {
	type ActionHost,
	actionControls,
	actionId,
	createEntry,
	type Entry,
	errorMessage,
} from "./actions/entry.js";
import { ActionExecution } from "./actions/execution.js";
import { commandKey } from "./descriptors.js";
import type {
	ActionHandle,
	ActionJournal,
	ActionOutcome,
	ActionProjection,
	ActionSnapshot,
	CommandDescriptor,
	GrantRef,
	Watch,
} from "./types.js";

export { actionId } from "./actions/entry.js";

export class ActionRegistry {
	private entries = new Map<string, Entry>();
	private listeners = new Set<() => void>();
	private cached: readonly ActionSnapshot[] = [];
	private sequence = 0;
	private closed = false;
	private pending = new Set<() => void>();
	private retiredIds = new Set<string>();
	private admission: ActionAdmission;
	private execution: ActionExecution;

	constructor(private host: ActionHost) {
		this.admission = new ActionAdmission(
			host.maxConcurrentActions,
			() => this.closed,
		);
		this.execution = new ActionExecution(
			host,
			this.admission,
			(entry) => this.publish(entry),
			() => this.closed,
		);
	}

	capacityReason(command: CommandDescriptor): string | undefined {
		return capacityReason(command, this.entries.values(), this.host);
	}

	private publish(entry?: Entry): void {
		if (entry)
			entry.snapshot = Object.freeze({
				...entry.snapshot,
				references: [
					...entry.bindings,
					...entry.projections.map((projection) => ({
						resource: projection.resource,
						identity: projection.identity ?? projection.requested,
					})),
					...(entry.command.target === undefined
						? []
						: [
								{
									resource: entry.command.resource,
									identity: entry.command.target,
								},
							]),
				],
				revision: ++this.sequence,
				controls: actionControls(entry, this.host),
			});
		const settled = [...this.entries.values()].filter(
			(item) =>
				item.snapshot.phase === "settled" &&
				(item.snapshot.outcome?.kind !== "unknown" ||
					item.definition.execution === "control"),
		);
		for (const retired of settled.slice(
			0,
			Math.max(0, settled.length - this.host.maxSettledActions),
		)) {
			this.entries.delete(retired.snapshot.id);
			this.retiredIds.add(retired.snapshot.id);
			retired.forgotten = true;
			retired.fingerprint = null;
			retired.command = {
				kind: "command",
				resource: "",
				name: "",
				input: undefined,
			};
			retired.metadata = undefined;
			retired.transfer = undefined;
			retired.cancelTransfer = undefined;
			retired.projections = [];
			retired.bindings = [];
			retired.snapshot = {
				id: retired.snapshot.id,
				resource: "",
				name: "",
				contextId: retired.snapshot.contextId,
				phase: "settled",
				recovery: retired.snapshot.recovery,
				revision: ++this.sequence,
				outcome: {
					kind: "unknown",
					message: "This activity has left the retained history",
				},
				controls: { canCancel: false, canRetry: false },
			};
			for (const listener of retired.listeners) this.pending.add(listener);
		}
		for (const item of this.entries.values()) {
			const controls = actionControls(item, this.host);
			if (
				controls.canCancel !== item.snapshot.controls.canCancel ||
				controls.canRetry !== item.snapshot.controls.canRetry
			) {
				item.snapshot = Object.freeze({
					...item.snapshot,
					controls,
					revision: ++this.sequence,
				});
				for (const listener of item.listeners) this.pending.add(listener);
			}
		}
		this.cached = Object.freeze(
			[...this.entries.values()]
				.filter((item) => this.host.access.allowsAny(item.bases))
				.map((item) => item.snapshot),
		);
		if (entry)
			for (const listener of entry.listeners) this.pending.add(listener);
		for (const listener of this.listeners) this.pending.add(listener);
		this.host.changed();
	}

	flushNotifications(): void {
		const pending = [...this.pending];
		this.pending.clear();
		for (const listener of pending) {
			try {
				listener();
			} catch (error) {
				this.host.report(error);
			}
		}
	}

	private make(
		command: CommandDescriptor,
		id: string,
		origin?: string,
		journal?: ActionJournal,
	): Entry {
		const entry = createEntry(
			this.host,
			++this.sequence,
			command,
			id,
			origin,
			journal,
		);
		this.entries.set(id, entry);
		return entry;
	}

	run(
		command: CommandDescriptor,
		options: { id?: string; origin?: string } = {},
	): ActionHandle {
		if (this.closed) throw new Error("Runtime is closed");
		const id = options.id ?? actionId();
		if (this.retiredIds.has(id))
			throw new Error(
				"This action ID was already admitted and has left the retained history",
			);
		const previous = this.entries.get(id);
		if (previous) {
			let fingerprint: string | null;
			try {
				fingerprint = commandKey(command);
			} catch {
				fingerprint = null;
			}
			if (fingerprint === null || fingerprint !== previous.fingerprint)
				throw new Error(
					"Action ID was already admitted with different or non-comparable input",
				);
			return this.handle(previous);
		}
		const capacity = this.capacityReason(command);
		const entry = this.make(command, id, options.origin);
		if (capacity) {
			this.execution.finish(entry, {
				kind: "failed",
				submitted: false,
				error: {
					code: "capacity",
					message: capacity,
				},
			});
			return this.handle(entry);
		}
		const availability = this.host.availability(command);
		if (!["available", "unknown"].includes(availability.state)) {
			this.execution.finish(entry, {
				kind: "failed",
				error: {
					code: availability.state,
					message: availability.reason ?? "The action is unavailable",
				},
				submitted: false,
			});
			return this.handle(entry);
		}
		try {
			entry.projections =
				entry.definition.project?.(
					command,
					this.host.context(entry.controller.signal),
				) ?? [];
			entry.metadata = entry.definition.recovery?.(command);
			this.publish(entry);
			void this.execution.execute(entry, false);
		} catch (error) {
			this.execution.finish(entry, {
				kind: "failed",
				error: { message: errorMessage(error) },
				submitted: false,
			});
		}
		return this.handle(entry);
	}

	private handle(entry: Entry): ActionHandle {
		return {
			id: entry.snapshot.id,
			result: entry.result,
			getSnapshot: () => entry.snapshot,
			subscribe: (listener) => {
				entry.listeners.add(listener);
				return () => entry.listeners.delete(listener);
			},
			cancel: async () => {
				if (!actionControls(entry, this.host).canCancel)
					throw new Error("This action cannot be canceled");
				if (entry.cancelTransfer) await entry.cancelTransfer();
				else
					await entry.definition.cancel?.(
						entry.metadata,
						this.execution.context(entry),
					);
			},
			retry: (options) => {
				if (!actionControls(entry, this.host).canRetry)
					throw new Error("The action cannot safely be retried");
				return this.run(entry.command, {
					origin: entry.snapshot.origin,
					...options,
				});
			},
		};
	}

	async recover(journals: readonly ActionJournal[]): Promise<void> {
		for (const journal of journals)
			this.sequence = Math.max(this.sequence, journal.snapshot.revision);
		for (const journal of journals) {
			if (
				this.entries.has(journal.id) ||
				!this.host.definition(journal.command) ||
				!this.host.access.allowsAny(journal.bases)
			)
				continue;
			const entry = this.make(
				journal.command,
				journal.id,
				journal.snapshot.origin,
				journal,
			);
			// A later submission checkpoint may have failed while dispatch continued.
			if (
				journal.snapshot.phase === "settled" &&
				journal.snapshot.outcome?.kind !== "unknown"
			) {
				entry.snapshot = journal.snapshot;
				entry.resolve(
					journal.snapshot.outcome ?? {
						kind: "unknown",
						message: "Outcome was not recorded",
					},
				);
				entry.actor.send({ type: "SETTLE" });
			} else {
				entry.projections =
					entry.definition.projectRecovery?.(
						entry.metadata,
						this.host.context(entry.controller.signal),
					) ?? [];
				for (const binding of entry.bindings)
					entry.projections = entry.projections.map((projection) =>
						projection.resource === binding.resource &&
						projection.kind === "create"
							? { ...projection, identity: binding.identity }
							: projection,
					);
				void this.execution.execute(entry, true);
			}
			this.publish(entry);
		}
	}

	retireTransferAdmissions(contextId: string): GrantRef[] {
		return [...this.entries.values()].flatMap((entry) =>
			entry.transfer?.admission
				? proofLeaves(entry.transfer.admission).filter(
						(ref) =>
							ref.contextId === contextId &&
							!this.host.access.contextIndependent(ref.scope),
					)
				: [],
		);
	}

	accessChanged(): void {
		for (const [id, entry] of this.entries) {
			entry.bases = this.host.access.surviving(entry.bases);
			entry.bases = entry.bases.map((proof) =>
				mapProof(proof, (basis) =>
					basis.generation === 0 &&
					entry.snapshot.contextId === this.host.access.contextId &&
					this.host.access.state(basis.scope) === "allowed"
						? this.host.access.ref(basis.scope)
						: basis,
				),
			);
			if (entry.bases.length === 0) {
				entry.forgotten = true;
				entry.controller.abort();
				entry.actor.stop();
				entry.command = {
					kind: "command",
					resource: "",
					name: "",
					input: undefined,
				};
				entry.metadata = undefined;
				entry.transfer = undefined;
				entry.cancelTransfer = undefined;
				entry.transfer = undefined;
				entry.cancelTransfer = undefined;
				entry.fingerprint = null;
				entry.projections = [];
				entry.bindings = [];
				const outcome: ActionOutcome = {
					kind: "unknown",
					message: "Access to this activity was revoked",
				};
				entry.snapshot = {
					id,
					resource: "",
					name: "",
					contextId: this.host.access.contextId,
					phase: "settled",
					recovery: "unavailable",
					revision: ++this.sequence,
					outcome,
					controls: { canCancel: false, canRetry: false },
				};
				entry.resolve(outcome);
				this.entries.delete(id);
				this.retiredIds.add(id);
				for (const listener of entry.listeners) this.pending.add(listener);
			} else if (!this.host.access.allowsAny(entry.bases))
				entry.controller.abort();
		}
		this.publish();
	}

	projections(): readonly {
		action: ActionSnapshot;
		projection: ActionProjection;
	}[] {
		return [...this.entries.values()]
			.filter((entry) => this.host.access.allowsAny(entry.bases))
			.flatMap((entry) =>
				entry.projections.map((projection) => ({
					action: entry.snapshot,
					projection,
				})),
			);
	}
	list(): readonly ActionSnapshot[] {
		return this.cached;
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	watch(id: string): Watch<ActionSnapshot | undefined> {
		return {
			getSnapshot: () => this.cached.find((entry) => entry.id === id),
			subscribe: (listener) => this.subscribe(listener),
		};
	}
	close(): void {
		this.closed = true;
		for (const entry of this.entries.values()) {
			entry.controller.abort();
			entry.actor.stop();
			entry.resolve({
				kind: "unknown",
				message: "Runtime stopped before the outcome was established",
			});
			entry.command = {
				kind: "command",
				resource: "",
				name: "",
				input: undefined,
			};
			entry.fingerprint = null;
			entry.metadata = undefined;
			entry.transfer = undefined;
			entry.cancelTransfer = undefined;
			entry.projections = [];
			entry.bindings = [];
			entry.bases = [];
			entry.forgotten = true;
			entry.snapshot = {
				id: entry.snapshot.id,
				resource: "",
				name: "",
				contextId: "",
				phase: "settled",
				outcome: { kind: "unknown", message: "Runtime closed" },
				recovery: "unavailable",
				revision: ++this.sequence,
				controls: { canCancel: false, canRetry: false },
			};
			entry.listeners.clear();
		}
		this.entries.clear();
		this.cached = [];
		this.pending.clear();
		this.retiredIds.clear();
		this.admission.close();
		this.listeners.clear();
	}
}
