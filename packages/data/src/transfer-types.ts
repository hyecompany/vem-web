// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	ActionContext,
	ActionOutcome,
	CommandDescriptor,
	DisclosureProof,
} from "./types.js";

/** HTTP work described by a command; upload bytes are never copied into the action journal. */
export interface TransferRequest {
	url: string;
	method: string;
	headers?: Readonly<Record<string, string>>;
	body?: Blob;
	credentials?: RequestCredentials;
}
/** Bounded transport evidence; an HTTP response still needs the command's outcome interpretation. */
export type TransferReceipt =
	| {
			kind: "response";
			status: number;
			headers: Readonly<Record<string, string>>;
			body: string;
	  }
	| { kind: "unknown"; message: string };
/** Returned only when no browser handoff was attempted, making an owner-bound attempt safe. */
export interface TransferUnavailable {
	kind: "unavailable";
	reason: string;
}
/** Observation lifetime is independent of execution; aborting signal must not cancel accepted browser work. */
export interface TransferObserver {
	signal: AbortSignal;
	/** Recheck live admission immediately before a new handoff. */
	canSubmit(): boolean;
	progress(value: {
		completed?: number;
		total?: number;
		message?: string;
	}): void;
	accepted(): void;
}
/** Optional host executor. Recover investigates the existing action ID and never starts a replacement transfer. */
export interface TransferExecutor {
	start(
		id: string,
		request: TransferRequest,
		observer: TransferObserver,
	): Promise<TransferReceipt | TransferUnavailable>;
	recover(id: string, observer: TransferObserver): Promise<TransferReceipt>;
	cancel(id: string): Promise<void>;
}
/** Execution ownership, distinct from recovery-journal durability. Browser ownership begins after acceptance. */
export interface TransferExecution {
	lifetime: "owner" | "browser";
	reason?: string;
}
/** Framework-owned handoff evidence attached to the existing protected action journal. */
export interface TransferRecord {
	version: 1;
	state: "prepared" | "dispatching" | "accepted";
	/** Captured admission generations gate new dispatch, independently of result disclosure. */
	admission?: DisclosureProof;
	receipt?: TransferReceipt;
}
/** Declare an HTTP transfer once; Vem owns submission, progress, cancellation and recovery. */
export interface TransferDefinition {
	prepare(
		command: CommandDescriptor,
		context: ActionContext,
	): TransferRequest | Promise<TransferRequest>;
	complete(
		receipt: TransferReceipt,
		context: ActionContext,
	): ActionOutcome | Promise<ActionOutcome>;
}
