// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { createActor, createMachine } from "xstate";
import type { AccessRegistry } from "../access.js";
import { captureBasis } from "../access-proofs.js";
import { commandKey } from "../descriptors.js";
import type { TransferExecutor, TransferRecord } from "../transfer-types.js";
import type {
	ActionJournal,
	ActionOutcome,
	ActionProjection,
	ActionSnapshot,
	Availability,
	CommandDefinition,
	CommandDescriptor,
	DisclosureProof,
	PersistenceAdapter,
	ResourceContext,
} from "../types.js";

const lifecycle = createMachine({
	id: "activity",
	initial: "preparing",
	states: {
		preparing: {
			on: { RUN: "running", RECOVER: "recovering", SETTLE: "settled" },
		},
		running: { on: { SETTLE: "settled" } },
		recovering: { on: { SETTLE: "settled" } },
		settled: { type: "final" },
	},
});
export interface ActionHost {
	access: AccessRegistry;
	persistence?: PersistenceAdapter;
	transfers?: TransferExecutor;
	transferFetch?: typeof fetch;
	checkpointTimeoutMs: number;
	maxSettledActions: number;
	maxConcurrentActions: number;
	maxPendingActions: number;
	maxUnresolvedActions: number;
	definition(command: CommandDescriptor): CommandDefinition | undefined;
	availability(command: CommandDescriptor): Availability;
	context(signal: AbortSignal): ResourceContext;
	changed(): void;
	persist(work: Promise<void>): Promise<void>;
	report(error: unknown): void;
}
export interface Entry {
	command: CommandDescriptor;
	definition: CommandDefinition;
	fingerprint: string | null;
	snapshot: ActionSnapshot;
	bases: DisclosureProof[];
	projections: readonly ActionProjection[];
	metadata: unknown;
	transfer?: TransferRecord;
	cancelTransfer?: () => Promise<void>;
	controller: AbortController;
	actor: ReturnType<typeof createActor<typeof lifecycle>>;
	result: Promise<ActionOutcome>;
	resolve: (outcome: ActionOutcome) => void;
	recovered: boolean;
	forgotten: boolean;
	bindings: { resource: string; identity: unknown }[];
	possibleSubmission: boolean;
	releaseSubmission?: () => void;
	listeners: Set<() => void>;
}
export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "The action could not be completed";
export const actionId = () => globalThis.crypto.randomUUID();
export function createEntry(
	host: ActionHost,
	revision: number,
	command: CommandDescriptor,
	id: string,
	origin?: string,
	journal?: ActionJournal,
): Entry {
	const definition = host.definition(command);
	if (!definition)
		throw new Error(`Unknown command ${command.resource}.${command.name}`);
	let resolve!: (outcome: ActionOutcome) => void;
	const result = new Promise<ActionOutcome>((done) => {
		resolve = done;
	});
	const controller = new AbortController();
	const bases = journal
		? host.access.surviving(journal.bases)
		: [
				captureBasis(
					typeof definition.disclosure === "function"
						? definition.disclosure(command, host.context(controller.signal))
						: definition.disclosure,
					(scope) => host.access.ref(scope),
				),
			];
	let fingerprint: string | null;
	try {
		fingerprint = commandKey(command);
	} catch {
		fingerprint = null;
	}
	const entry: Entry = {
		command,
		definition,
		fingerprint,
		bases,
		controller,
		result,
		resolve,
		actor: createActor(lifecycle),
		metadata: journal?.metadata,
		transfer: journal?.transfer,
		projections: [],
		recovered: journal !== undefined,
		forgotten: false,
		listeners: new Set(),
		bindings: [...(journal?.bindings ?? [])],
		possibleSubmission: journal?.possibleSubmission ?? false,
		snapshot: {
			id,
			resource: command.resource,
			name: command.name,
			target: command.target,
			contextId: host.access.contextId,
			origin,
			phase: "preparing",
			...(definition.transfer
				? {
						execution: journal?.snapshot.execution ?? {
							lifetime: "owner" as const,
						},
					}
				: {}),
			recovery:
				definition.execution === "control"
					? "unavailable"
					: journal
						? "saved"
						: "pending",
			revision: revision,
			controls: { canCancel: false, canRetry: false },
		},
	};
	entry.actor.start();
	return entry;
}

export function actionControls(
	entry: Entry,
	host: ActionHost,
): ActionSnapshot["controls"] {
	const outcome = entry.snapshot.outcome;
	const retry =
		!entry.recovered &&
		outcome !== undefined &&
		(entry.definition.canRetry?.(
			outcome,
			entry.command,
			host.context(entry.controller.signal),
		) ??
			(outcome.kind === "failed" && outcome.submitted === false));
	const cancellation =
		entry.snapshot.phase !== "settled" &&
		(entry.definition.cancel || entry.cancelTransfer)
			? (entry.definition.cancelAvailability?.(
					entry.metadata,
					host.context(entry.controller.signal),
				) ?? { state: "unknown" })
			: { state: "unsupported" };
	return {
		canCancel: ["available", "unknown"].includes(cancellation.state),
		canRetry:
			entry.snapshot.phase === "settled" &&
			retry &&
			["available", "unknown"].includes(host.availability(entry.command).state),
	};
}
