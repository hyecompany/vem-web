// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region capabilities
import type { FilterCapabilities } from "@hyecompany/vem-data";

export const taskSearchFilters = {
	fields: ["title", "notes"],
	operators: ["equal", "contains"],
	combinations: ["all", "any"],
	text: [{ case: "insensitive", accents: "sensitive" }],
} satisfies FilterCapabilities;

// #endregion capabilities

// #region membership
import type {
	AcquisitionRequest,
	ObservationBatch,
} from "@hyecompany/vem-data/runtime";
import type { TaskRef } from "../task-board/contract.js";

export function taskSearchMembership(
	where: AcquisitionRequest["where"],
	identities: readonly TaskRef[],
	complete: boolean,
): ObservationBatch {
	return {
		memberships: [
			{
				resource: "tasks",
				where,
				identities,
				complete,
				basis: ["public"],
			},
		],
	};
}
// #endregion membership
