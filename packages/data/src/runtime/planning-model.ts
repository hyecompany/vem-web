// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { MissingRequirement } from "../read-model/requirements.js";
import type { QueryPopulation } from "../read-model/types.js";
import type {
	AcquisitionRequest,
	AcquisitionSource,
	EvidenceRef,
	QueryDescriptor,
	QueryIssue,
	ResourceDefinition,
} from "../types.js";
import type { SelectionCost } from "./planning-score.js";
import type { SelectionOption } from "./planning-selection.js";
import type { AcquisitionSupersession } from "./planning-supersession.js";
import type { QueryFailure } from "./query-issues.js";
import type { QueryState } from "./state.js";

export interface PlannedAcquisition {
	key: string;
	baseKey: string;
	resource: string;
	source: AcquisitionSource;
	request: AcquisitionRequest;
	cost: SelectionCost;
	states: QueryState[];
	/** Stale query requirements whose selected acquisition path uses this work. */
	revalidates?: ReadonlyMap<string, ReadonlySet<string>>;
	/** Original consumer evidence served by this selected path, including dependencies on other resources. */
	requirements?: ReadonlyMap<string, readonly MissingRequirement[]>;
	generation: number;
	succeeded?: boolean;
	seenIdentities: Set<string>;
	identityKey(identity: unknown): string;
}
export interface PlanningHost {
	evidenceGeneration?(ref: EvidenceRef): number;
	population(request: AcquisitionRequest): QueryPopulation;
	matches(request: AcquisitionRequest, identity: unknown): boolean;
	definition(resource: string): ResourceDefinition;
	accessIssue?(query: QueryDescriptor): QueryIssue | undefined;
	requirements(
		query: QueryDescriptor,
		forcedFields?: readonly string[],
	): readonly MissingRequirement[];
}
export interface Need {
	key: string;
	requirement: MissingRequirement;
	state: QueryState;
	dependencies: Need[];
	issue?: QueryIssue;
	options?: SelectionOption[];
}
export interface Candidate extends PlannedAcquisition {
	covers: Set<string>;
}
export interface PlanningResult {
	supersessions: readonly AcquisitionSupersession[];
	work: PlannedAcquisition[];
	waiting: PlannedAcquisition[];
	uncovered: QueryState[];
	failures: ReadonlyMap<QueryState, readonly QueryFailure[]>;
}

export type AttemptedSource = (
	state: QueryState,
	candidate: PlannedAcquisition,
	requirement: MissingRequirement,
) => boolean;
