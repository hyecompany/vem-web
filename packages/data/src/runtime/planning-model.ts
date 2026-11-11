// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { MissingRequirement } from "../read-model/requirements.js";
import type {
	AcquisitionRequest,
	AcquisitionSource,
	EvidenceRef,
	QueryDescriptor,
	QueryIssue,
	ResourceDefinition,
} from "../types.js";
import type { SelectionOption } from "./planning-selection.js";
import type { QueryState } from "./state.js";

export interface PlannedAcquisition {
	key: string;
	baseKey: string;
	resource: string;
	source: AcquisitionSource;
	request: AcquisitionRequest;
	cost: number;
	states: QueryState[];
	/** Stale query requirements whose selected acquisition path uses this work. */
	revalidates?: ReadonlyMap<string, ReadonlySet<string>>;
	generation: number;
	succeeded?: boolean;
	seenIdentities: Set<string>;
	identityKey(identity: unknown): string;
}
export interface PlanningHost {
	evidenceGeneration?(ref: EvidenceRef): number;
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
	options?: SelectionOption[];
}
export interface Candidate extends PlannedAcquisition {
	covers: Set<string>;
}
export interface PlanningResult {
	work: PlannedAcquisition[];
	waiting: PlannedAcquisition[];
	uncovered: QueryState[];
	issues: ReadonlyMap<QueryState, QueryIssue>;
}

export type AttemptedSource = (
	state: QueryState,
	candidate: PlannedAcquisition,
	requirement: MissingRequirement,
) => boolean;
