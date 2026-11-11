// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ReadModelDelta } from "./read-model/publication.js";
import type { QueryAcquisitionState } from "./read-model/types.js";
import type {
	AccessSnapshot,
	ActionSnapshot,
	Availability,
	QueryResult,
} from "./types.js";

export type { AccessSnapshot } from "./types.js";
export const protocolVersion = 8;

export function feedbackStage(
	action: Pick<ActionSnapshot, "phase" | "outcome">,
): string {
	return action.phase === "settled"
		? (action.outcome?.kind ?? "settled")
		: "active";
}

export interface Compatibility {
	protocol: number;
	schema: number;
	definitions: number;
	build: string;
}
export interface QueryDelta {
	id: string;
	status: QueryAcquisitionState;
}
export interface Publication {
	type: "publish";
	epoch: string;
	base: number;
	revision: number;
	reset: boolean;
	readModel: ReadModelDelta;
	queries: readonly QueryDelta[];
	forgottenQueries?: readonly string[];
	availability: readonly { id: string; value: Availability }[];
	activities: readonly ActionSnapshot[];
	access: AccessSnapshot;
	feedback: readonly string[];
}

export function emptyResult<T extends object, I>(): QueryResult<T, I> {
	return {
		rows: [],
		unresolved: [],
		confirmed: { complete: false, knownCount: 0, total: undefined },
		activities: [],
		stale: false,
		revalidating: false,
		fetching: false,
		settled: false,
		empty: false,
		exists: undefined,
		issues: [],
		revision: 0,
	};
}
