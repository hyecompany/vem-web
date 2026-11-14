// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryProjection } from "../read-model/query-projector.js";
import {
	type MissingRequirement,
	requirementKey,
} from "../read-model/requirements.js";
import type {
	QueryDescriptor,
	ReadStatus,
	ReadStatusHandle,
} from "../types.js";
import { equal, frozen } from "../values.js";
import type { AcquisitionQueue } from "./acquisition.js";
import type { QueryRegistry } from "./queries.js";
import { currentFailures, type QueryFailure } from "./query-issues.js";
import type { QueryState } from "./state.js";

interface ReadStatusHost {
	projection: QueryProjection;
	queries: QueryRegistry;
	acquisitions: AcquisitionQueue;
	subscribe(listener: () => void): () => void;
}

function retryableFailure({
	state,
	failures,
}: {
	state: QueryState;
	failures: QueryFailure[];
}): boolean {
	return (
		state.fetching === 0 &&
		state.attempted >= state.version &&
		failures.some((failure) => failure.retryable)
	);
}

/** Project existing demand and work; this observer never registers a demand of its own. */
export function watchReadStatus(
	host: ReadStatusHost,
	query: QueryDescriptor,
): ReadStatusHandle {
	let disposed = false;
	const subscriptions = new Set<() => void>();
	let cached: ReadStatus | undefined;
	const current = (state: QueryState) =>
		host.projection.requirements(
			state.descriptor,
			state.attempted < state.forced
				? state.descriptor.sample?.fields
				: undefined,
		);
	const matching = (requirements: readonly MissingRequirement[]) =>
		requirements.filter((requirement) =>
			host.projection.matchesWork(query, requirement),
		);
	const unsuccessful = () => {
		return [...host.queries.states.values()].flatMap((state) => {
			if (!state.active || !state.issues.length) return [];
			const failures = currentFailures(state, current(state)).filter(
				(failure) => matching(failure.requirements).length,
			);
			return failures.length ? [{ state, failures }] : [];
		});
	};
	const snapshot = (): ReadStatus => {
		if (disposed) throw new Error("Read status handle was disposed");
		let pending = false,
			revalidating = false;
		const inspect = (requirements: readonly MissingRequirement[]) => {
			const relevant = matching(requirements);
			pending ||= relevant.length > 0;
			revalidating ||= relevant.some((requirement) => requirement.stale);
		};
		for (const state of host.queries.states.values())
			if (
				state.active &&
				state.fetching === 0 &&
				state.attempted < state.version
			)
				inspect(current(state));
		const remainingByState = new Map<QueryState, ReadonlySet<string>>();
		for (const work of host.acquisitions.work()) {
			let remaining = remainingByState.get(work.state);
			if (!remaining) {
				remaining = new Set(current(work.state).map(requirementKey));
				remainingByState.set(work.state, remaining);
			}
			inspect(
				work.requirements.filter((requirement) =>
					remaining.has(requirementKey(requirement)),
				),
			);
		}
		const failed = unsuccessful();
		const issues: ReadStatus["issues"][number][] = [];
		for (const { failures } of failed)
			for (const { issue } of failures)
				if (!issues.some((known) => equal(known, issue))) issues.push(issue);
		const value = {
			pending,
			revalidating,
			issues,
			canRetry: failed.some(retryableFailure),
		};
		if (!equal(cached, value)) cached = frozen(value);
		return cached as ReadStatus;
	};
	return {
		getSnapshot: snapshot,
		subscribe(listener) {
			if (disposed) throw new Error("Read status handle was disposed");
			let previous = snapshot();
			const off = host.subscribe(() => {
				if (disposed) return;
				const next = snapshot();
				if (next === previous) return;
				previous = next;
				listener();
			});
			subscriptions.add(off);
			return () => {
				subscriptions.delete(off);
				off();
			};
		},
		async retry() {
			if (disposed) throw new Error("Read status handle was disposed");
			await Promise.all(
				unsuccessful()
					.filter(retryableFailure)
					.map(({ state }) => host.queries.retry(state)),
			);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const off of subscriptions) off();
			subscriptions.clear();
		},
	};
}
