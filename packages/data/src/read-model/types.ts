// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { KnownRecord, QueryIssue, Values } from "../types.js";

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
	revision: number;
	currencyRevision?: number;
	stale?: boolean;
}
export interface ReadModelSnapshot {
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
