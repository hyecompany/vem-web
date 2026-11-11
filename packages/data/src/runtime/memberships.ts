// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import { stableKey } from "../descriptors.js";
import type {
	KnownCollection,
	MembershipRef,
	PersistedMembership,
} from "../types.js";
import { equal, frozen } from "../values.js";
import type { KnowledgeStore } from "./knowledge.js";
import type { QueryState } from "./state.js";

export function membershipKey(ref: MembershipRef): string {
	return `${ref.resource}:${stableKey(ref.scope)}:${stableKey(ref.where ?? {})}`;
}

export function membershipInvalidationKey(ref: MembershipRef): string {
	return `membership:${membershipKey(ref)}`;
}

export function knownCollections(
	memberships: ReadonlyMap<string, PersistedMembership>,
	grants: AccessRegistry,
	resource: string,
): readonly KnownCollection[] {
	return frozen(
		[...memberships.values()]
			.filter(
				(value) => value.resource === resource && grants.allowsAny(value.bases),
			)
			.map((value) => ({
				resource,
				scope: structuredClone(value.scope),
				where: structuredClone(value.where),
				identities: structuredClone(value.identities),
				complete: value.complete,
			})),
	);
}

export function withdrawMembership(
	store: KnowledgeStore,
	queries: Iterable<QueryState>,
	ref: MembershipRef,
): PersistedMembership | undefined {
	const key = membershipKey(ref);
	const previous = store.memberships.get(key);
	store.invalidations.set(membershipInvalidationKey(ref), ++store.revision);
	store.membershipGeneration++;
	store.touched.add(key);
	const next = previous && {
		...previous,
		complete: false,
		stale: true,
		supports: previous.supports.map((support) => ({ ...support, stale: true })),
	};
	if (next) store.memberships.set(key, next);
	for (const state of queries) {
		if (
			state.descriptor.resource === ref.resource &&
			equal(state.descriptor.scope, ref.scope)
		)
			state.version++;
	}
	return next;
}
