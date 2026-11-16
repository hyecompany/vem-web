// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionOutcome, ActionPhase, QueryDescriptor } from "./types.js";

/** Only the displayed stage is retained when acknowledging feedback, never protected result payloads. */
export interface FeedbackObservation {
	phase: ActionPhase;
	outcome?: { kind: ActionOutcome["kind"] };
}

/** Optional consumer capability for shared feedback ownership; it never executes or cancels work. */
export interface FeedbackClient {
	subscribeFeedback(listener: () => void): () => void;
	/** IDs currently assigned to this consumer for unsolicited feedback. */
	feedback(): readonly string[];
	/** Claim inline presentation until the returned release function runs. */
	claimFeedback(ids: readonly string[]): () => void;
	/** Claim current and future activities associated with this query while the region is mounted. */
	claimQueryFeedback<T extends object, I>(
		query: QueryDescriptor<T, I>,
	): () => void;
	/** Acknowledge only the observed action stage; a later outcome remains eligible. */
	acknowledgeFeedback(id: string, observed?: FeedbackObservation): void;
}

export function hasFeedbackClient(value: unknown): value is FeedbackClient {
	if (!value || typeof value !== "object") return false;
	return [
		"subscribeFeedback",
		"feedback",
		"claimFeedback",
		"claimQueryFeedback",
		"acknowledgeFeedback",
	].every(
		(name) => typeof (value as Record<string, unknown>)[name] === "function",
	);
}
