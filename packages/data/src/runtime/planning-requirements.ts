// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import {
	evaluateAccess,
	readAccess,
} from "../read-model/access-requirements.js";
import {
	type MissingRequirement,
	requirementKey,
} from "../read-model/requirements.js";
import type { QueryIssue, ResourceContext } from "../types.js";
import type { Need, PlanningHost } from "./planning-model.js";
import { prerequisiteResolver } from "./planning-prerequisites.js";
import type { QueryState } from "./state.js";

const MAX_REQUIREMENTS = 4096;
const MAX_DEPTH = 32;
export function buildRequirements(
	host: PlanningHost,
	states: readonly QueryState[],
	context: ResourceContext,
): {
	needs: Map<string, Need>;
	roots: Need[];
	issues: Map<QueryState, QueryIssue>;
} {
	const needs = new Map<string, Need>();
	const roots: Need[] = [];
	const issues = new Map<QueryState, QueryIssue>();
	const perState = Math.max(
		1,
		Math.floor(MAX_REQUIREMENTS / Math.max(1, states.length)),
	);
	const counts = new Map<QueryState, number>();
	const resolvers = new Map(
		states.map((state) => [
			state,
			prerequisiteResolver(host, context, perState),
		]),
	);
	const required = (state: QueryState) => {
		const resolver = resolvers.get(state);
		if (!resolver)
			throw new Error("A planning state has no prerequisite budget");
		return resolver;
	};
	const add = (
		requirement: MissingRequirement,
		state: QueryState,
		path: Set<string>,
		depth: number,
	): Need | undefined => {
		const semantic = requirementKey(requirement);
		if (path.has(semantic) || depth > MAX_DEPTH) return undefined;
		const key = stableKey([state.key, semantic]);
		const existing = needs.get(key);
		if (existing) return existing;
		if (
			needs.size >= MAX_REQUIREMENTS ||
			(counts.get(state) ?? 0) >= perState
		) {
			issues.set(state, {
				kind: "incomplete",
				message:
					"This read reached its share of the planning bound; retry can continue with remaining information",
			});
			return undefined;
		}
		counts.set(state, (counts.get(state) ?? 0) + 1);
		const node: Need = { key, requirement, state, dependencies: [] };
		needs.set(key, node);
		if (
			requirement.kind === "collection-field" &&
			host.definition(requirement.resource).fieldDependencies?.[
				requirement.field ?? ""
			]
		) {
			const membership = add(
				{
					kind: "membership",
					resource: requirement.resource,
					scope: requirement.query.scope,
					where: requirement.query.where,
					query: requirement.query,
				},
				state,
				new Set([...path, semantic]),
				depth + 1,
			);
			if (membership) node.dependencies.push(membership);
		}
		if (
			requirement.kind === "field" ||
			requirement.kind === "presence" ||
			requirement.kind === "membership"
		) {
			const definition = host.definition(requirement.resource);
			const prerequisites =
				(requirement.kind === "membership"
					? definition.membershipDependencies?.(requirement.query, context)
					: requirement.kind === "presence"
						? definition.presenceDependencies?.(requirement.identity, context)
						: definition.fieldDependencies?.[requirement.field ?? ""]?.(
								requirement.identity,
								context,
							)) ?? [];
			const nextPath = new Set([...path, semantic]);
			for (const prerequisite of prerequisites) {
				let missing: readonly MissingRequirement[];
				if ("kind" in prerequisite && prerequisite.kind === "query") {
					if (
						evaluateAccess(
							readAccess(host.definition(prerequisite.resource), prerequisite),
							context.access,
						) === "denied"
					) {
						node.dependencies = [];
						break;
					}
					const result = required(state)(prerequisite, undefined, true);
					if (result.issue) {
						issues.set(state, result.issue);
						node.dependencies = [];
						break;
					}
					missing = result.requirements;
				} else if ("relationship" in prerequisite) {
					const relation = context.relationship(
						prerequisite.resource,
						prerequisite.identity,
						prerequisite.relationship,
					);
					missing =
						relation?.complete && !relation.stale
							? []
							: [
									{
										kind: "relationship",
										generation: Math.max(
											requirement.generation ?? 0,
											host.evidenceGeneration?.(prerequisite) ?? 0,
										),
										resource: prerequisite.resource,
										identity: prerequisite.identity,
										relationship: prerequisite.relationship,
										query: {
											kind: "query",
											resource: prerequisite.resource,
											mode: "one",
											identity: prerequisite.identity,
											select: [],
										},
									},
								];
				} else continue;
				for (const value of missing) {
					const dependency = add(value, state, nextPath, depth + 1);
					if (dependency) node.dependencies.push(dependency);
				}
			}
		}
		return node;
	};
	for (const state of states) {
		const forced =
			state.attempted < state.forced
				? (state.descriptor.sample?.fields ?? [])
				: undefined;
		const result = required(state)(state.descriptor, forced);
		if (result.issue) issues.set(state, result.issue);
		for (const missing of result.requirements) {
			const node = add(missing, state, new Set(), 0);
			if (node) roots.push(node);
		}
	}
	return { needs, roots, issues };
}
