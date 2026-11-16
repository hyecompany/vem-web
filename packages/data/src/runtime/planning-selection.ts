// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	addCosts,
	compareCosts,
	divideCost,
	impossibleScore,
	type SelectionCost,
	type SelectionScore,
	zeroScore,
} from "./planning-score.js";

export interface SelectionCandidate {
	key: string;
	cost: SelectionCost;
}
export type SelectionOption = ReadonlySet<string>;
export interface SelectionDemand {
	options: readonly SelectionOption[];
}
const SEARCH_LIMIT = 12000;
const OPTION_LIMIT = 96;

export function planCost(
	keys: Iterable<string>,
	candidates: ReadonlyMap<string, SelectionCandidate>,
): SelectionScore {
	let cost = zeroScore;
	for (const key of keys) {
		const candidate = candidates.get(key);
		if (!candidate) return impossibleScore;
		cost = addCosts(cost, candidate.cost);
	}
	return cost;
}
function contains(
	selected: ReadonlySet<string>,
	option: SelectionOption,
): boolean {
	return [...option].every((key) => selected.has(key));
}
function append(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): Set<string> {
	return new Set([...left, ...right]);
}
export function combineOptions(
	groups: readonly (readonly SelectionOption[])[],
	candidates: ReadonlyMap<string, SelectionCandidate>,
): SelectionOption[] {
	let options: SelectionOption[] = [new Set()];
	for (const group of groups) {
		if (!group.length) return [];
		const unique = new Map<string, SelectionOption>();
		for (const previous of options)
			for (const next of group) {
				const joined = append(previous, next);
				unique.set([...joined].sort().join("\n"), joined);
			}
		options = [...unique.values()]
			.sort(
				(a, b) =>
					compareCosts(planCost(a, candidates), planCost(b, candidates)) ||
					a.size - b.size,
			)
			.slice(0, OPTION_LIMIT);
	}
	return options;
}

/** Joint bounded search: preserve the best plan found when the combinatorial search budget is exhausted. */
export function selectAcquisitions(
	demands: readonly SelectionDemand[],
	candidates: ReadonlyMap<string, SelectionCandidate>,
): Set<string> {
	const supported = demands.filter((demand) => demand.options.length);
	const mandatory = new Set(
		supported
			.filter((demand) => demand.options.length === 1)
			.flatMap((demand) => [...(demand.options[0] ?? [])]),
	);
	let best = new Set(mandatory);
	const uniqueOptions = new Map<
		string,
		{ keys: SelectionOption; serves: number[] }
	>();
	for (const [index, demand] of supported.entries())
		for (const option of demand.options) {
			const key = [...option].sort().join("\n");
			const existing = uniqueOptions.get(key) ?? { keys: option, serves: [] };
			existing.serves.push(index);
			uniqueOptions.set(key, existing);
		}
	let covered = supported.map((demand) =>
		demand.options.some((option) => contains(best, option)),
	);
	for (let round = 0; round < 128 && covered.some((value) => !value); round++) {
		let choice: SelectionOption | undefined;
		let score: SelectionCost = impossibleScore;
		for (const option of uniqueOptions.values()) {
			const gained = option.serves.filter((index) => !covered[index]).length;
			if (!gained) continue;
			const additional = [...option.keys].filter((key) => !best.has(key));
			const value = divideCost(planCost(additional, candidates), gained);
			if (
				compareCosts(value, score) < 0 ||
				(compareCosts(value, score) === 0 &&
					additional.length < (choice?.size ?? Infinity))
			) {
				choice = option.keys;
				score = value;
			}
		}
		if (!choice) break;
		for (const key of choice) best.add(key);
		covered = supported.map(
			(demand, index) =>
				covered[index] ||
				demand.options.some((option) => contains(best, option)),
		);
	}
	for (const [index, demand] of supported.entries()) {
		if (
			covered[index] ||
			demand.options.some((option) => contains(best, option))
		)
			continue;
		let choice: SelectionOption | undefined;
		let cost: SelectionCost = impossibleScore;
		for (const option of demand.options) {
			const marginal = planCost(
				[...option].filter((key) => !best.has(key)),
				candidates,
			);
			if (compareCosts(marginal, cost) < 0) {
				choice = option;
				cost = marginal;
			}
		}
		if (choice) for (const key of choice) best.add(key);
	}
	if (supported.length > 128 || candidates.size > 128) return best;
	let bestCost: SelectionCost = planCost(best, candidates);
	let visited = 0;
	const seen = new Set<string>();
	const search = (selected: Set<string>, cost: SelectionCost) => {
		if (++visited > SEARCH_LIMIT || compareCosts(cost, bestCost) > 0) return;
		const key = [...selected].sort().join("\n");
		if (seen.has(key)) return;
		seen.add(key);
		const missing = supported.filter(
			(demand) => !demand.options.some((option) => contains(selected, option)),
		);
		if (!missing.length) {
			if (
				compareCosts(cost, bestCost) < 0 ||
				(compareCosts(cost, bestCost) === 0 && selected.size < best.size)
			) {
				best = selected;
				bestCost = cost;
			}
			return;
		}
		missing.sort((a, b) => a.options.length - b.options.length);
		const alternatives = (missing[0]?.options ?? [])
			.map((option) => append(selected, option))
			.sort(
				(a, b) =>
					compareCosts(planCost(a, candidates), planCost(b, candidates)) ||
					a.size - b.size,
			);
		for (const next of alternatives) search(next, planCost(next, candidates));
	};
	search(mandatory, planCost(mandatory, candidates));
	return best;
}
