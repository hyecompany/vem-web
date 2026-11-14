// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	type MissingRequirement,
	requirementKey,
} from "../read-model/requirements.js";
import type { QueryIssue } from "../types.js";
import { equal } from "../values.js";
import type { QueryState } from "./state.js";

export interface QueryFailure {
	issue: QueryIssue;
	retryable: boolean;
	requirements: readonly MissingRequirement[];
}

/** Keep one current explanation per failed requirement, never a history of attempts. */
export function failQuery(
	state: QueryState,
	issue: QueryIssue,
	requirements: readonly MissingRequirement[],
	retryable = true,
): void {
	const replacing = new Set(requirements.map(requirementKey));
	const failures: QueryFailure[] = (state.failures ?? [])
		.filter((failure) => state.issues.includes(failure.issue))
		.map((failure) => ({
			...failure,
			requirements: failure.requirements.filter(
				(requirement) => !replacing.has(requirementKey(requirement)),
			),
		}))
		.filter((failure) => failure.requirements.length);
	const previous = failures.find(
		(failure) => equal(failure.issue, issue) && failure.retryable === retryable,
	);
	if (previous)
		previous.requirements = [...previous.requirements, ...requirements];
	else failures.push({ issue, requirements, retryable });
	state.failures = failures;
	state.issues = failures.map((failure) => failure.issue);
}

export function currentFailures(
	state: QueryState,
	requirements: readonly MissingRequirement[],
): QueryFailure[] {
	const remaining = new Set(requirements.map(requirementKey));
	return (state.failures ?? [])
		.filter((failure) => state.issues.includes(failure.issue))
		.map((failure) => ({
			...failure,
			requirements: failure.requirements.filter((requirement) =>
				remaining.has(requirementKey(requirement)),
			),
		}))
		.filter((failure) => failure.requirements.length);
}
