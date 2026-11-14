// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { feedbackCandidates } from "../feedback-policy.js";
import type { FeedbackObservation } from "../feedback-types.js";
import { feedbackStage } from "../protocol.js";
import type { QueryDescriptor } from "../types.js";
import type { ClientInspector, ScenarioFeedback } from "./types.js";

export function scenarioFeedback(
	inspector: ClientInspector,
): ScenarioFeedback & { close(): void } {
	const claims = new Map<symbol, readonly string[]>();
	const queryClaims = new Map<symbol, string>();
	const acknowledgements = new Map<string, string>();
	const listeners = new Set<() => void>();
	let snapshot: readonly string[] = [];
	const publish = () => {
		const current = inspector.getSnapshot();
		const inline = new Set([...claims.values()].flat());
		for (const query of current.queries)
			if ([...queryClaims.values()].includes(query.id))
				for (const action of query.result?.activities ?? [])
					inline.add(action.id);
		const next = feedbackCandidates(current.actions, inline, acknowledgements);
		if (
			next.length === snapshot.length &&
			next.every((id, index) => id === snapshot[index])
		)
			return;
		snapshot = next;
		const retained = new Set(current.actions.map((action) => action.id));
		for (const id of acknowledgements.keys())
			if (!retained.has(id)) acknowledgements.delete(id);
		for (const listener of listeners) listener();
	};
	const stop = inspector.subscribe(publish);
	const feedback = {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => snapshot,
		claim(ids: readonly string[]) {
			const key = Symbol();
			claims.set(key, ids);
			publish();
			return () => {
				claims.delete(key);
				publish();
			};
		},
		claimQuery<T extends object, I>(query: QueryDescriptor<T, I>) {
			const key = Symbol();
			queryClaims.set(key, stableKey(query));
			publish();
			return () => {
				queryClaims.delete(key);
				publish();
			};
		},
		acknowledge(id: string, observed?: FeedbackObservation) {
			const current = inspector
				.getSnapshot()
				.actions.find((action) => action.id === id);
			if (
				current &&
				(!observed || feedbackStage(current) === feedbackStage(observed))
			)
				acknowledgements.set(id, feedbackStage(current));
			publish();
		},
		close() {
			stop();
			claims.clear();
			queryClaims.clear();
			acknowledgements.clear();
			listeners.clear();
			snapshot = [];
		},
	};
	return {
		...feedback,
		subscribeFeedback: feedback.subscribe,
		feedback: feedback.getSnapshot,
		claimFeedback: feedback.claim,
		claimQueryFeedback: feedback.claimQuery,
		acknowledgeFeedback: feedback.acknowledge,
	};
}
