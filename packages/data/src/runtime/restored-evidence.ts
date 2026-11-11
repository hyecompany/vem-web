// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import type {
	DisclosureProof,
	EvidenceSupport,
	PersistedFact,
	PersistedMembership,
} from "../types.js";
import type { KnowledgeStore } from "./knowledge.js";
import type { Cell } from "./state.js";

function restoreSupport<T extends EvidenceSupport>(
	support: T,
	knowledge: KnowledgeStore,
	grants: AccessRegistry,
): T {
	const currency = knowledge.continuity.currency(support.liveness);
	return {
		...support,
		bases: grants.surviving(support.bases).map((proof) => grants.adopt(proof)),
		disclosureDependencies: support.disclosureDependencies?.map((proofs) =>
			grants.surviving(proofs).map((proof) => grants.adopt(proof)),
		),
		stale:
			support.stale === true ||
			currency.stale ||
			currency.liveness !== "immutable",
	};
}

export function restoreFact(
	fact: PersistedFact,
	bases: readonly DisclosureProof[],
	knowledge: KnowledgeStore,
	grants: AccessRegistry,
): Cell {
	const supports = fact.supports.map((support) =>
		restoreSupport(support, knowledge, grants),
	);
	return {
		...fact,
		bases,
		supports,
		revision: -1,
		...knowledge.supportCurrency(supports),
	};
}

export function restoreMembership(
	membership: PersistedMembership,
	bases: readonly DisclosureProof[],
	knowledge: KnowledgeStore,
	grants: AccessRegistry,
): PersistedMembership {
	const supports = membership.supports.map((support) =>
		restoreSupport(support, knowledge, grants),
	);
	return {
		...membership,
		bases,
		supports,
		revision: -1,
		stale: knowledge.supportCurrency(supports).stale,
		complete: supports.some(
			(support) =>
				support.complete && !knowledge.supportCurrency([support]).stale,
		),
	};
}
