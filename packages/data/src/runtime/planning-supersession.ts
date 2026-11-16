// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { requirementKey } from "../read-model/requirements.js";
import type {
	Candidate,
	Need,
	PlannedAcquisition,
	PlanningHost,
} from "./planning-model.js";

export interface AcquisitionSupersession {
	key: string;
	replacements: readonly string[];
	demand: string;
}

/** Compare original demand, including scope and generation, again immediately before canceling. */
export function acquisitionDemandKey(
	host: PlanningHost,
	work: PlannedAcquisition,
): string | undefined {
	const demand = work.states
		.filter((state) => state.active)
		.flatMap((state) => {
			const requirements = host.requirements(
				state.descriptor,
				state.attempted < state.forced
					? state.descriptor.sample?.fields
					: undefined,
			);
			return requirements.length
				? [[state.key, requirements.map(requirementKey).sort()]]
				: [];
		});
	return demand.length
		? stableKey(demand.sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
		: undefined;
}

/** Only direct coverage replaces a read; a prerequisite alone does not supply its eventual evidence. */
export function acquisitionSupersessions(
	host: PlanningHost,
	inflight: readonly PlannedAcquisition[],
	selected: readonly PlannedAcquisition[],
	candidates: ReadonlyMap<string, Candidate>,
	needs: ReadonlyMap<string, Need>,
): AcquisitionSupersession[] {
	const chosen = new Set(selected.map((work) => work.key));
	return inflight.flatMap((work) => {
		if (chosen.has(work.key)) return [];
		const demand = acquisitionDemandKey(host, work);
		if (!demand) return [];
		const replacements = new Set<string>();
		for (const state of work.states) {
			if (!state.active) continue;
			for (const requirement of host.requirements(
				state.descriptor,
				state.attempted < state.forced
					? state.descriptor.sample?.fields
					: undefined,
			)) {
				const node = needs.get(
					stableKey([state.key, requirementKey(requirement)]),
				);
				const replacement =
					node &&
					selected.find((source) =>
						candidates.get(source.key)?.covers.has(node.key),
					);
				if (!replacement) return [];
				replacements.add(replacement.key);
			}
		}
		return [{ key: work.key, replacements: [...replacements], demand }];
	});
}
