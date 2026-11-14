// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { feedbackCandidates } from "../feedback-policy.js";
import type { FeedbackClient } from "../feedback-types.js";
import { feedbackStage } from "../protocol.js";
import type { DataClient, QueryHandle } from "../types.js";

/** Single-consumer feedback for deterministic tests, using the owner's stage and inline policy. */
export function createTestFeedback(
	client: DataClient,
): FeedbackClient & { close(): void } {
	const claims = new Map<symbol, readonly string[]>();
	const queries = new Map<symbol, QueryHandle>();
	const acknowledged = new Map<string, string>();
	const listeners = new Set<() => void>();
	let snapshot: readonly string[] = [];
	const publish = () => {
		const actions = client.listActivities();
		const inline = new Set([...claims.values()].flat());
		for (const query of queries.values())
			for (const action of query.getSnapshot().activities)
				inline.add(action.id);
		const next = feedbackCandidates(actions, inline, acknowledged);
		for (const id of acknowledged.keys())
			if (!actions.some((action) => action.id === id)) acknowledged.delete(id);
		if (
			next.length === snapshot.length &&
			next.every((id, index) => id === snapshot[index])
		)
			return;
		snapshot = next;
		for (const listener of listeners) listener();
	};
	const stop = client.subscribe(publish);
	publish();
	return {
		feedback: () => snapshot,
		subscribeFeedback(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		claimFeedback(ids) {
			const key = Symbol();
			claims.set(key, ids);
			publish();
			return () => {
				claims.delete(key);
				publish();
			};
		},
		claimQueryFeedback(descriptor) {
			const key = Symbol(),
				handle = client.watch(descriptor);
			queries.set(key, handle as QueryHandle);
			publish();
			return () => {
				queries.delete(key);
				publish();
			};
		},
		acknowledgeFeedback(id, observed) {
			const current = client
				.listActivities()
				.find((action) => action.id === id);
			if (
				current &&
				(!observed || feedbackStage(current) === feedbackStage(observed))
			)
				acknowledged.set(id, feedbackStage(current));
			publish();
		},
		close() {
			stop();
			queries.clear();
			claims.clear();
			acknowledged.clear();
			listeners.clear();
			snapshot = [];
		},
	};
}
