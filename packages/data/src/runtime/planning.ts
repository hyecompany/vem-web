// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import {
	type MissingRequirement,
	requirementKey,
} from "../read-model/requirements.js";
import type { ResourceContext } from "../types.js";
import { buildCandidates } from "./planning-candidates.js";
import type {
	AttemptedSource,
	Need,
	PlannedAcquisition,
	PlanningHost,
	PlanningResult,
} from "./planning-model.js";
import { buildRequirements } from "./planning-requirements.js";
import {
	combineOptions,
	type SelectionOption,
	selectAcquisitions,
} from "./planning-selection.js";
import { acquisitionSupersessions } from "./planning-supersession.js";
import type { QueryFailure } from "./query-issues.js";
import type { QueryState } from "./state.js";

export type { PlannedAcquisition } from "./planning-model.js";

/** Plan all consumers and discovered prerequisites together before choosing source work. */
export function planAcquisitions(
	host: PlanningHost,
	states: readonly QueryState[],
	context: ResourceContext,
	inflight: readonly PlannedAcquisition[],
	attempted: AttemptedSource,
): PlanningResult {
	const {
		needs,
		roots,
		issues: prerequisiteIssues,
	} = buildRequirements(host, states, context);
	const { candidates, blocked } = buildCandidates(
		host,
		needs,
		context,
		inflight,
		attempted,
	);
	const directByNeed = new Map<string, SelectionOption[]>();
	for (const candidate of candidates.values())
		for (const key of candidate.covers) {
			const choices = directByNeed.get(key) ?? [];
			choices.push(new Set([candidate.key]));
			directByNeed.set(key, choices);
		}
	const options = (node: Need, path: Set<string>): SelectionOption[] => {
		if (path.has(node.key)) return [];
		if (node.options) return node.options;
		const direct: SelectionOption[] = [...(directByNeed.get(node.key) ?? [])];
		if (node.dependencies.length)
			direct.push(
				...combineOptions(
					node.dependencies.map((dependency) =>
						options(dependency, new Set([...path, node.key])),
					),
					candidates,
				),
			);
		node.options = direct;
		return direct;
	};
	for (const root of roots) options(root, new Set());
	const selected = selectAcquisitions(
		roots.map((root) => ({ options: root.options ?? [] })),
		candidates,
	);
	const requiredBy = new Map<string, Set<QueryState>>();
	const revalidates = new Map<string, Map<string, Set<string>>>();
	const requirements = new Map<string, Map<string, MissingRequirement[]>>();
	const requirementKeys = new Map<string, Map<string, Set<string>>>();
	const witnessCosts = new Map(
		[...candidates].map(([key]) => [key, { key, cost: 1 }]),
	);
	const byState = new Map<QueryState, Need[]>();
	for (const root of roots) {
		const scoped = byState.get(root.state) ?? [];
		scoped.push(root);
		byState.set(root.state, scoped);
	}
	for (const state of states) {
		const demands = (byState.get(state) ?? []).map((root) => ({
			options: (root.options ?? []).filter((option) =>
				[...option].every((key) => selected.has(key)),
			),
		}));
		const witness = selectAcquisitions(demands, witnessCosts);
		for (const key of witness) {
			const consumers = requiredBy.get(key) ?? new Set<QueryState>();
			consumers.add(state);
			requiredBy.set(key, consumers);
		}
		const stale = host
			.requirements(state.descriptor)
			.filter((requirement) => requirement.stale)
			.map(requirementKey);
		for (const root of byState.get(state) ?? []) {
			const checking =
				stableKey(root.requirement.query) !== stableKey(state.descriptor)
					? stale
					: root.requirement.stale
						? [requirementKey(root.requirement)]
						: [];
			const original =
				stableKey(root.requirement.query) !== stableKey(state.descriptor)
					? host.requirements(state.descriptor)
					: [root.requirement];
			const path = (root.options ?? [])
				.filter((option) => [...option].every((key) => witness.has(key)))
				.sort((a, b) => a.size - b.size)[0];
			for (const key of path ?? []) {
				const demands =
					requirements.get(key) ?? new Map<string, MissingRequirement[]>();
				const requested = demands.get(state.key) ?? [];
				const keys = requirementKeys.get(key) ?? new Map<string, Set<string>>();
				const seen = keys.get(state.key) ?? new Set<string>();
				for (const requirement of original) {
					const identity = requirementKey(requirement);
					if (!seen.has(identity)) {
						seen.add(identity);
						requested.push(requirement);
					}
				}
				keys.set(state.key, seen);
				requirementKeys.set(key, keys);
				demands.set(state.key, requested);
				requirements.set(key, demands);
				if (!checking.length) continue;
				const queries = revalidates.get(key) ?? new Map<string, Set<string>>();
				const evidence = queries.get(state.key) ?? new Set<string>();
				for (const requirement of checking) evidence.add(requirement);
				queries.set(state.key, evidence);
				revalidates.set(key, queries);
			}
		}
	}
	const work: PlannedAcquisition[] = [],
		waiting: PlannedAcquisition[] = [];
	for (const key of selected) {
		const candidate = candidates.get(key);
		if (!candidate) continue;
		candidate.states = [...(requiredBy.get(key) ?? [])];
		candidate.revalidates = revalidates.get(key);
		candidate.requirements = requirements.get(key);
		if (!candidate.states.length) continue;
		(inflight.some((value) => value.key === key) ? waiting : work).push(
			candidate,
		);
	}
	const assigned = new Set(
		[...work, ...waiting].flatMap((value) => value.states),
	);
	const uncovered = states.filter((state) => !assigned.has(state));
	const failures = new Map<QueryState, QueryFailure[]>();
	const coveredBy = (need: Need, covers: ReadonlySet<string>): boolean =>
		covers.has(need.key) ||
		need.dependencies.some((dependency) => coveredBy(dependency, covers));
	for (const state of uncovered) {
		const prerequisite = prerequisiteIssues.get(state);
		if (prerequisite) {
			failures.set(state, [
				{
					issue: prerequisite,
					retryable: prerequisite.kind !== "access",
					requirements: host.requirements(state.descriptor),
				},
			]);
			continue;
		}
		const explanations = (node: Need): QueryFailure["issue"][] => [
			...(node.issue ? [node.issue] : []),
			...node.dependencies.flatMap(explanations),
		];
		for (const root of byState.get(state) ?? []) {
			const requirements =
				stableKey(root.requirement.query) === stableKey(state.descriptor)
					? [root.requirement]
					: host.requirements(state.descriptor);
			const entries = failures.get(state) ?? [];
			for (const issue of explanations(root))
				entries.push({
					issue,
					requirements,
					retryable: issue.kind !== "access",
				});
			if (entries.length) failures.set(state, entries);
		}
		for (const admission of blocked) {
			const affected = (byState.get(state) ?? []).filter((root) =>
				coveredBy(root, admission.candidate.covers),
			);
			const requirements = affected.flatMap((root) =>
				stableKey(root.requirement.query) === stableKey(state.descriptor)
					? [root.requirement]
					: host.requirements(state.descriptor),
			);
			if (!requirements.length) continue;
			const entries = failures.get(state) ?? [];
			entries.push({ issue: admission.issue, requirements, retryable: false });
			failures.set(state, entries);
		}
	}
	return {
		work,
		waiting,
		uncovered,
		failures,
		supersessions: acquisitionSupersessions(
			host,
			inflight,
			[...waiting, ...work],
			candidates,
			needs,
		),
	};
}
