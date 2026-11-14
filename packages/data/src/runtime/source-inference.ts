// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { filterEqualities } from "../filters.js";
import type { AcquisitionRequest, ObservationBatch } from "../types.js";
import { equal } from "../values.js";
import type { PlannedAcquisition } from "./planning-model.js";

/** A declared equality filter is value evidence for identities actually returned under that filter. */
export function inferSourceFacts(
	work: PlannedAcquisition,
	request: AcquisitionRequest,
	batch: ObservationBatch,
): ObservationBatch {
	if (request.mode !== "list" || !work.source.filters) return batch;
	const facts = (batch.memberships ?? []).flatMap((membership) => {
		if (
			membership.resource !== request.resource ||
			!equal(membership.scope, request.scope)
		)
			return [];
		const values = Object.fromEntries(
			Object.entries(filterEqualities(membership.where)).filter(
				([field, value]) =>
					Object.hasOwn(filterEqualities(request.where), field) &&
					equal(value, filterEqualities(request.where)[field]),
			),
		);
		if (!Object.keys(values).length) return [];
		return membership.identities.map((identity) => ({
			resource: membership.resource,
			identity,
			values,
			basis: membership.basis,
			liveness: membership.liveness,
		}));
	});
	return facts.length
		? { ...batch, facts: [...facts, ...(batch.facts ?? [])] }
		: batch;
}
