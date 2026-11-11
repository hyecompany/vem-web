// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionContext, ActionOutcome } from "../types.js";
import type { ActionAdmission } from "./admission.js";
import { type ActionHost, type Entry, errorMessage } from "./entry.js";
import { checkpoint } from "./journal.js";
import { executeTransfer } from "./transfer-execution.js";

export class ActionExecution {
	constructor(
		private host: ActionHost,
		private admission: ActionAdmission,
		private publish: (entry: Entry) => void,
		private isClosed: () => boolean,
	) {}
	private checkpoint(entry: Entry): Promise<void> {
		return checkpoint(entry, this.host, this.publish);
	}
	context(entry: Entry): ActionContext {
		const base = this.host.context(entry.controller.signal);
		return {
			...base,
			get acquisitionFence() {
				return base.acquisitionFence;
			},
			actionId: entry.snapshot.id,
			submitted: () => {
				entry.releaseSubmission?.();
				entry.releaseSubmission = undefined;
			},
			bind: (resource, identity) => {
				if (entry.forgotten || entry.snapshot.phase === "settled") return;
				entry.bindings = [
					...entry.bindings.filter((binding) => binding.resource !== resource),
					{ resource, identity },
				];
				entry.projections = entry.projections.map((projection) =>
					projection.resource === resource && projection.kind === "create"
						? { ...projection, identity }
						: projection,
				);
				this.publish(entry);
				void this.checkpoint(entry);
			},
			progress: (progress) => {
				if (entry.forgotten || entry.snapshot.phase === "settled") return;
				entry.snapshot = { ...entry.snapshot, progress };
				this.publish(entry);
			},
			checkpoint: async (metadata) => {
				if (entry.forgotten) return;
				entry.metadata = metadata;
				await this.checkpoint(entry);
			},
		};
	}

	async execute(entry: Entry, recovery: boolean): Promise<void> {
		try {
			const control = entry.definition.execution === "control";
			if (!recovery && !control) await this.checkpoint(entry);
			if (!control)
				entry.releaseSubmission = await this.admission.acquire(entry, recovery);
			if (entry.forgotten || this.isClosed()) return;
			if (
				!recovery &&
				!["available", "unknown"].includes(
					this.host.availability(entry.command).state,
				)
			) {
				this.finish(entry, {
					kind: "failed",
					submitted: false,
					error: {
						code: "access",
						message: "Access changed while this action was queued",
					},
				});
				return;
			}
			if (!recovery && !control) {
				entry.possibleSubmission = true;
				await this.checkpoint(entry);
			}
			if (entry.forgotten || this.isClosed()) return;
			if (
				!recovery &&
				!["available", "unknown"].includes(
					this.host.availability(entry.command).state,
				)
			) {
				this.finish(entry, {
					kind: "failed",
					error: {
						code: "access",
						message: "Access changed before submission",
					},
					submitted: false,
				});
				return;
			}
			entry.actor.send({ type: recovery ? "RECOVER" : "RUN" });
			entry.snapshot = {
				...entry.snapshot,
				phase: recovery ? "recovering" : "running",
			};
			this.publish(entry);
			const context = this.context(entry);
			const outcome = entry.definition.transfer
				? await executeTransfer(
						entry,
						this.host,
						context,
						this.publish,
						recovery,
					)
				: recovery
					? await (entry.definition.recover?.(entry.metadata, context) ??
							Promise.resolve({
								kind: "unknown" as const,
								message: "The previous attempt needs investigation",
							}))
					: await entry.definition.run(entry.command, context);
			if (!entry.forgotten && !this.isClosed()) this.finish(entry, outcome);
		} catch (error) {
			if (!entry.forgotten && !this.isClosed())
				this.finish(
					entry,
					entry.definition.execution === "control"
						? {
								kind: "failed",
								submitted: false,
								error: { message: errorMessage(error) },
							}
						: { kind: "unknown", message: errorMessage(error) },
				);
		} finally {
			entry.releaseSubmission?.();
			entry.releaseSubmission = undefined;
		}
	}

	finish(entry: Entry, outcome: ActionOutcome): void {
		if (entry.forgotten) return;
		entry.cancelTransfer = undefined;
		entry.actor.send({ type: "SETTLE" });
		entry.snapshot = { ...entry.snapshot, phase: "settled", outcome };
		entry.projections =
			outcome.kind === "failed"
				? entry.projections.filter(
						(projection) =>
							projection.kind === "create" &&
							projection.retainOnFailure !== false,
					)
				: outcome.kind === "unknown"
					? entry.projections
					: [];
		this.publish(entry);
		entry.resolve(outcome);
		void this.checkpoint(entry);
	}
}
