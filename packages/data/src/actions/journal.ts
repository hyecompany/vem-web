// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionJournal, ActionOutcome } from "../types.js";
import type { ActionHost, Entry } from "./entry.js";

export function actionJournal(entry: Entry): ActionJournal {
	const outcome = entry.snapshot.outcome;
	const durableOutcome: ActionOutcome | undefined = !outcome
		? undefined
		: outcome.kind === "succeeded"
			? { kind: "succeeded" }
			: outcome.kind === "partial"
				? {
						kind: "partial",
						value: undefined,
						message: "Some effects completed; inspect current resource state",
					}
				: outcome.kind === "failed"
					? {
							kind: "failed",
							error: {
								code: outcome.error.code,
								message: "The request failed",
							},
							submitted: outcome.submitted,
						}
					: {
							kind: "unknown",
							message: "The previous operation requires investigation",
						};
	return {
		id: entry.snapshot.id,
		command: {
			kind: "command",
			resource: entry.command.resource,
			name: entry.command.name,
			target: entry.command.target,
			input: undefined,
		},
		snapshot: {
			...entry.snapshot,
			outcome: durableOutcome,
			progress: entry.snapshot.progress && {
				completed: entry.snapshot.progress.completed,
				total: entry.snapshot.progress.total,
			},
		},
		metadata: entry.metadata,
		bases: entry.bases,
		possibleSubmission: entry.possibleSubmission,
		transfer: entry.transfer,
		bindings: entry.bindings,
	};
}

export async function checkpoint(
	entry: Entry,
	host: ActionHost,
	publish: (entry: Entry) => void,
): Promise<void> {
	if (entry.forgotten || entry.definition.execution === "control") return;
	if (!host.persistence) {
		entry.snapshot = { ...entry.snapshot, recovery: "unavailable" };
		publish(entry);
		return;
	}
	const write = host.persist(
		host.persistence.writeAction(actionJournal(entry)),
	);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			write,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Recovery checkpoint deadline exceeded")),
					host.checkpointTimeoutMs,
				);
			}),
		]);
		if (!entry.forgotten)
			entry.snapshot = { ...entry.snapshot, recovery: "saved" };
	} catch (error) {
		if (!entry.forgotten)
			entry.snapshot = { ...entry.snapshot, recovery: "unavailable" };
		host.report(error);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		if (!entry.forgotten) publish(entry);
	}
}
