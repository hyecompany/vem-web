// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { filterFields } from "../filters.js";
import type {
	AcquisitionRequest,
	KnownCollection,
	ResourceContext,
} from "../types.js";
import { equal } from "../values.js";
import type { Candidate, Need, PlanningHost } from "./planning-model.js";
import { sourceFilter } from "./source-filters.js";

/** Existing filtered inventories describe useful source boundaries even after their original consumer is satisfied. */
export function membershipCandidates(
	host: PlanningHost,
	context: ResourceContext,
	candidates: ReadonlyMap<string, Candidate>,
	targetNeeds: (candidate: Candidate) => readonly Need[],
	keyFor: (candidate: Candidate, request: AcquisitionRequest) => string,
): Candidate[] {
	const additions = new Map<string, Candidate>();
	const collections = new Map<string, Map<string, KnownCollection[]>>();
	const demanded = new Map<string, Set<string>>();
	for (const candidate of candidates.values()) {
		if (candidate.request.mode !== "list" || !candidate.source.filters)
			continue;
		const keys = demanded.get(candidate.resource) ?? new Set<string>();
		for (const { requirement } of targetNeeds(candidate))
			if (
				requirement.kind !== "membership" &&
				requirement.kind !== "collection-field"
			)
				keys.add(candidate.identityKey(requirement.identity));
		demanded.set(candidate.resource, keys);
	}
	for (const candidate of candidates.values()) {
		if (candidate.request.mode !== "list" || !candidate.source.filters)
			continue;
		let index = collections.get(candidate.resource);
		if (!index) {
			index = new Map();
			for (const membership of context.memberships(candidate.resource)) {
				if (!filterFields(membership.where).length) continue;
				for (const identity of membership.identities) {
					const key = candidate.identityKey(identity);
					if (!demanded.get(candidate.resource)?.has(key)) continue;
					const included = index.get(key) ?? [];
					included.push(membership);
					index.set(key, included);
				}
			}
			collections.set(candidate.resource, index);
		}
		const identities = new Map(
			targetNeeds(candidate)
				.filter(
					({ requirement }) =>
						requirement.kind !== "membership" &&
						requirement.kind !== "collection-field",
				)
				.map(({ requirement }) => [
					candidate.identityKey(requirement.identity),
					requirement.identity,
				]),
		);
		const relevant = new Map<KnownCollection, unknown[]>();
		for (const [key, identity] of identities) {
			for (const membership of index.get(key) ?? []) {
				if (!equal(membership.scope, candidate.request.scope)) continue;
				const targets = relevant.get(membership) ?? [];
				targets.push(identity);
				relevant.set(membership, targets);
			}
		}
		for (const [membership, targets] of relevant) {
			if (candidates.size + additions.size >= 4096)
				return [...additions.values()];
			if (
				!membership.where ||
				!equal(membership.scope, candidate.request.scope)
			)
				continue;
			const where = sourceFilter(candidate.source, membership.where, context);
			if (!where) continue;
			const request = { ...candidate.request, where };
			const key = keyFor(candidate, request);
			if (candidates.has(key) || additions.has(key)) continue;
			if (!targets.some((identity) => host.matches(request, identity)))
				continue;
			additions.set(key, {
				...candidate,
				key,
				baseKey: key,
				request,
				covers: new Set(),
				seenIdentities: new Set(),
			});
		}
	}
	return [...additions.values()];
}
