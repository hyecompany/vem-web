// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryResult } from "@hyecompany/vem-data";
import type { ObservationBatch } from "@hyecompany/vem-data/runtime";

type ProjectRef = { name: string };

// #region identity-event
export function projectRenamed(
	oldName: string,
	name: string,
): ObservationBatch {
	return {
		identityTransitions: [
			{
				resource: "projects",
				from: { name: oldName },
				to: { name },
				basis: ["projects:events"],
				liveness: { channel: "project-events" },
			},
		],
		facts: [
			{
				resource: "projects",
				identity: { name },
				values: { name },
				basis: ["projects:events"],
				liveness: { channel: "project-events" },
			},
		],
	};
}
// #endregion identity-event

// #region follow-identity
export function followSelectedProject(
	selected: { identity: ProjectRef; incarnation: string },
	result: QueryResult<{ name: string }, ProjectRef>,
) {
	// Capture selected.incarnation from the row or detail when the user selects it.
	const transition = result.identityTransitions?.find(
		(entry) => entry.from.incarnation === selected.incarnation,
	);
	return transition?.to ?? selected;
}
// #endregion follow-identity
