// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { MissingRequirement } from "../read-model/requirements.js";
import type { QueryPopulation } from "../read-model/types.js";
import type {
	AcquisitionRequest,
	AcquisitionSource,
	ResourceContext,
} from "../types.js";
import { surplusInformation } from "./acquisition-demand.js";
import type { PlanningHost } from "./planning-model.js";
import type { SelectionCost } from "./planning-score.js";

/** Compare observed response extent, never invent a population for an unseen collection. */
export function createAcquisitionCostEstimator(
	context: ResourceContext,
	host: PlanningHost,
) {
	const populations = new Map<string, QueryPopulation>();
	const populationFor = (request: AcquisitionRequest): QueryPopulation => {
		if (request.mode === "one")
			return { kind: "known", count: 1, evidence: "current" };
		const key = stableKey([
			request.resource,
			request.scope,
			request.where ?? {},
		]);
		const existing = populations.get(key);
		if (existing) return existing;
		const result = host.population(request);
		populations.set(key, result);
		return result;
	};
	return (
		source: AcquisitionSource,
		request: AcquisitionRequest,
		requirements: readonly MissingRequirement[],
		identityKey: (identity: unknown) => string,
	): SelectionCost => {
		const cost =
			typeof source.cost === "function"
				? source.cost(request, context)
				: source.cost;
		if (typeof cost === "number") {
			if (!(cost > 0) || !Number.isFinite(cost))
				throw new Error(
					`Source ${source.key} must declare a finite positive cost`,
				);
		}
		if (
			cost &&
			typeof cost !== "number" &&
			(!Number.isFinite(cost.request) ||
				cost.request <= 0 ||
				!Number.isFinite(cost.perItem) ||
				cost.perItem < 0)
		)
			throw new Error(`Invalid item-based acquisition cost for ${source.key}`);
		const population = populationFor(request);
		const unknown = population.kind === "unknown";
		const items =
			population.kind === "known"
				? population.count
				: population.kind === "bounded"
					? population.maximum
					: population.minimum;
		const pages = source.pagination
			? Math.max(1, Math.ceil(items / source.pagination.pageSize))
			: 1;
		// Width counts advertised values, not bytes or the cost of computing them.
		const width = 1 + request.fields.length + request.relationships.length;
		if (typeof cost === "number")
			return [0, 0, cost, 0, pages, 0, items * width];
		if (cost) {
			const unbounded =
				unknown && (cost.perItem > 0 || source.pagination !== undefined);
			return [
				Number(unbounded),
				Number(unbounded) * width,
				cost.request * pages + cost.perItem * items,
				0,
				0,
				0,
				0,
			];
		}
		const surplus = unknown
			? 0
			: surplusInformation(
					request,
					items,
					requirements,
					identityKey,
					populationFor,
				);
		return [
			Number(unknown),
			Number(unknown) * width,
			0,
			items * width,
			pages,
			surplus,
			0,
		];
	};
}
