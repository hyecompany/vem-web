// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { feedbackStage } from "./protocol.js";
import type { ActionSnapshot } from "./types.js";

/** The owner and deterministic clients apply the same inline and acknowledgement policy. */
export function feedbackCandidates(
	actions: readonly ActionSnapshot[],
	inline: ReadonlySet<string>,
	acknowledgements: ReadonlyMap<string, string>,
	eligible: (action: ActionSnapshot) => boolean = () => true,
): readonly string[] {
	return actions
		.filter(
			(action) =>
				eligible(action) &&
				!inline.has(action.id) &&
				acknowledgements.get(action.id) !== feedbackStage(action),
		)
		.map((action) => action.id);
}
