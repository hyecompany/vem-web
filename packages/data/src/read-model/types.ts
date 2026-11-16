// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	IdentityTransition,
	KnownRecord,
	QueryIssue,
	Values,
} from "../types.js";

export interface ReadModelEffectiveRecord extends KnownRecord {
	rowKey: string;
	proposal?: string;
	requested?: Values;
	actionIds: readonly string[];
}
export interface ReadModelFact {
	revision: number;
	currencyRevision?: number;
	stale?: boolean;
}
export interface ReadModelRecord {
	key: string;
	confirmed?: KnownRecord;
	effective?: ReadModelEffectiveRecord;
	facts: Readonly<Record<string, ReadModelFact>>;
}
export interface ReadModelMembership {
	key: string;
	resource: string;
	scope?: unknown;
	where?: Readonly<Values>;
	identities: readonly unknown[];
	complete: boolean;
	/** A still-authorized support enumerated the full inventory, even if its liveness is historical. */
	observedComplete: boolean;
	revision: number;
	currencyRevision?: number;
	stale?: boolean;
}
export interface ReadModelSnapshot {
	identityTransitions?: readonly IdentityTransition[];
	revision: number;
	records: readonly ReadModelRecord[];
	memberships: readonly ReadModelMembership[];
}
export interface QueryAcquisitionState {
	revalidating: boolean;
	fetching: boolean;
	settled: boolean;
	issues: readonly QueryIssue[];
}

/** Observed planning estimates; historical counts and bounds do not guarantee the current population. */
export type QueryPopulation =
	| {
			kind: "known";
			count: number;
			evidence: "current" | "historical";
	  }
	| {
			kind: "bounded";
			minimum: number;
			maximum: number;
			evidence: "current" | "historical";
	  }
	| {
			kind: "unknown";
			minimum: number;
			evidence: "current" | "historical";
	  };
