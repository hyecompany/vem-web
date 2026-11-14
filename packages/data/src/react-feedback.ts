// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { stableKey } from "./descriptors.js";
import type { FeedbackObservation } from "./feedback-types.js";
import { useDataClient, useFeedbackClient } from "./react-context.js";
import type { ActionSnapshot, QueryDescriptor } from "./types.js";

const empty: readonly string[] = [];
const emptyActions: readonly ActionSnapshot[] = [];
const noop = () => () => undefined;
/** Observe feedback assigned to this tab. Clients without this optional capability produce no unsolicited feedback. */
export function useFeedback() {
	const client = useDataClient(),
		feedback = useFeedbackClient();
	const binding = useMemo(
		() => ({
			subscribe: (listener: () => void) =>
				feedback?.subscribeFeedback(listener) ?? noop(),
			snapshot: () => feedback?.feedback() ?? empty,
			activities: () => (feedback ? client.listActivities() : emptyActions),
			subscribeActivities: (listener: () => void) =>
				feedback ? client.subscribeActivities(listener) : noop(),
			acknowledge: (id: string, observed?: FeedbackObservation) =>
				feedback?.acknowledgeFeedback(id, observed),
		}),
		[client, feedback],
	);
	const ids = useSyncExternalStore(
		binding.subscribe,
		binding.snapshot,
		() => empty,
	);
	const activities = useSyncExternalStore(
		binding.subscribeActivities,
		binding.activities,
		() => emptyActions,
	);
	return useMemo(
		() => ({
			activities: activities.filter((action) => ids.includes(action.id)),
			acknowledge: binding.acknowledge,
		}),
		[activities, ids, binding],
	);
}
/** Keep feedback inline while a region is active; releasing the claim permits normal toast handoff. */
export function useInlineFeedback<T extends object, I>(
	target: QueryDescriptor<T, I> | readonly string[],
	options: { active?: boolean } = {},
): void {
	const feedback = useFeedbackClient();
	const key = stableKey(target),
		active = options.active ?? true;
	// biome-ignore lint/correctness/useExhaustiveDependencies: Value identity avoids releasing equivalent inline descriptions.
	useEffect(() => {
		if (!feedback || !active || (Array.isArray(target) && target.length === 0))
			return;
		return Array.isArray(target)
			? feedback.claimFeedback(target)
			: feedback.claimQueryFeedback(target as QueryDescriptor<T, I>);
	}, [feedback, key, active]);
}
