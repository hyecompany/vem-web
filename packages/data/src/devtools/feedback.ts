// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { feedbackStage } from "../protocol.js";
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
		const next = current.actions
			.filter(
				(action) =>
					!inline.has(action.id) &&
					acknowledgements.get(action.id) !== feedbackStage(action),
			)
			.map((action) => action.id);
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
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => snapshot,
		claim(ids) {
			const key = Symbol();
			claims.set(key, ids);
			publish();
			return () => {
				claims.delete(key);
				publish();
			};
		},
		claimQuery(query) {
			const key = Symbol();
			queryClaims.set(key, stableKey(query));
			publish();
			return () => {
				queryClaims.delete(key);
				publish();
			};
		},
		acknowledge(id, observed) {
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
}
