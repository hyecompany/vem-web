// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ResourceContext } from "../types.js";
import type { PlannedAcquisition } from "./planning-model.js";

/** Shared prerequisites inherit their consumers' missing information, not their own response shape. */
export function acquisitionPriority(
	work?: PlannedAcquisition,
): NonNullable<ResourceContext["fetchPriority"]> {
	if (!work) return "high";
	let priority: "auto" | "low" = "auto";
	for (const state of work.states) {
		if (!state.active) continue;
		const requirements = work.requirements?.get(state.key);
		if (!requirements?.length) continue;
		if (requirements.some((requirement) => !requirement.stale)) return "high";
		priority = "low";
	}
	return priority;
}
