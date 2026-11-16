// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { MissingRequirement } from "../read-model/requirements.js";
import type { QueryPopulation } from "../read-model/types.js";
import type { AcquisitionRequest } from "../types.js";

/** Count surplus advertised values separately; needing every identity does not require every field. */
export function surplusInformation(
	request: AcquisitionRequest,
	items: number,
	requirements: readonly MissingRequirement[],
	identityKey: (identity: unknown) => string,
	populationFor: (request: AcquisitionRequest) => QueryPopulation,
): number {
	const identities = new Map<string, Set<string>>();
	const collections = new Map<string, number>();
	const addIdentity = (slot: string, identity: unknown) => {
		const keys = identities.get(slot) ?? new Set<string>();
		keys.add(identityKey(identity));
		identities.set(slot, keys);
	};
	for (const need of requirements) {
		const collection =
			need.kind === "membership" || need.kind === "collection-field";
		const slot =
			need.field !== undefined
				? `field:${need.field}`
				: need.relationship !== undefined
					? `relationship:${need.relationship}`
					: "identity";
		if (!collection) {
			addIdentity("identity", need.identity);
			addIdentity(slot, need.identity);
			continue;
		}
		const population = populationFor({
			...request,
			where: need.query.where,
		});
		const count =
			stableKey(request.where ?? {}) === stableKey(need.query.where ?? {})
				? items
				: population.kind === "known"
					? population.count
					: population.kind === "bounded"
						? population.maximum
						: population.minimum;
		for (const key of ["identity", slot])
			collections.set(key, Math.max(collections.get(key) ?? 0, count));
	}
	const slots = [
		"identity",
		...request.fields.map((field) => `field:${field}`),
		...request.relationships.map((field) => `relationship:${field}`),
	];
	return slots.reduce(
		(surplus, slot) =>
			surplus +
			Math.max(
				0,
				items -
					Math.max(identities.get(slot)?.size ?? 0, collections.get(slot) ?? 0),
			),
		0,
	);
}
