// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	AccessState,
	ActionSnapshot,
	FactRef,
	KnownRecord,
	QueryDescriptor,
	QueryIssue,
	QueryResult,
	ResourceReadDefinition,
} from "../types.js";
import type { MissingRequirement } from "./requirements.js";
import type {
	ReadModelEffectiveRecord as EffectiveRecord,
	ReadModelFact,
	ReadModelMembership,
} from "./types.js";

export interface QueryKnowledge {
	definition(resource: string): ResourceReadDefinition;
	recordKey(resource: string, identity: unknown): string;
	factKey(ref: FactRef): string;
	access(scope: string): AccessState;
	revision(): number;
	records: ReadonlyMap<string, KnownRecord>;
	resourceRecords: ReadonlyMap<string, ReadonlySet<string>>;
	memberships(): readonly ReadModelMembership[];
	cells: ReadonlyMap<string, ReadModelFact>;
	invalidations: ReadonlyMap<string, number>;
	activities(): readonly ActionSnapshot[];
	effective(key: string): EffectiveRecord | undefined;
	effectiveRecords(resource: string): Iterable<EffectiveRecord>;
	revalidating?(
		descriptor: QueryDescriptor,
		requirements: readonly MissingRequirement[],
	): boolean;
}

export interface ProjectionState {
	descriptor: QueryDescriptor;
	snapshot: QueryResult;
	version: number;
	attempted: number;
	forced: number;
	fetching: number;
	revalidating?: boolean;
	issues: readonly QueryIssue[];
}
