// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	KnownRecord,
	PersistedFact,
	QueryDescriptor,
	QueryIssue,
	QueryResult,
	Values,
} from "../types.js";
import type { QueryFailure } from "./query-issues.js";
export interface Cell extends PersistedFact {
	stale?: boolean;
	currencyRevision?: number;
}
export interface EffectiveRecord extends KnownRecord {
	rowKey: string;
	proposal?: string;
	requested?: Values;
	actionIds: readonly string[];
}
export interface QueryState {
	key: string;
	descriptor: QueryDescriptor;
	listeners: Set<() => void>;
	snapshot: QueryResult;
	projected?: QueryResult;
	version: number;
	attempted: number;
	forced: number;
	fetching: number;
	users: number;
	demands: number;
	waiters: number;
	issues: QueryIssue[];
	failures?: readonly QueryFailure[];
	active: boolean;
	timer?: ReturnType<typeof setInterval>;
}
