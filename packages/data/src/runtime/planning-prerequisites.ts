// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { MissingRequirement } from "../read-model/requirements.js";
import type { QueryDescriptor, QueryIssue, ResourceContext } from "../types.js";
import type { PlanningHost } from "./planning-model.js";

interface RequiredInformation {
	requirements: readonly MissingRequirement[];
	issue?: QueryIssue;
}
/** Resolve mandatory information stages without treating alternative derivations as admission prerequisites. */
export function prerequisiteResolver(
	host: PlanningHost,
	context: ResourceContext,
	limit = 4096,
) {
	let traversed = 0;
	const resolve = (
		query: QueryDescriptor,
		path = new Set<string>(),
		forced?: readonly string[],
		mandatory = false,
	): RequiredInformation => {
		const access = mandatory ? host.accessIssue?.(query) : undefined;
		if (access) return { requirements: [], issue: access };
		const missing = host.requirements(query, forced);
		if (!missing.length) return { requirements: [] };
		const key = stableKey(query);
		if (path.has(key) || path.size >= 32 || ++traversed > limit)
			return {
				requirements: [],
				issue: {
					kind: "unsupported",
					message:
						"Required read information contains a cycle or exceeds the planning bound",
				},
			};
		const prerequisites =
			host.definition(query.resource).readPrerequisites?.(query, context) ?? [];
		const staged: MissingRequirement[] = [];
		for (const prerequisite of prerequisites) {
			const result = resolve(
				prerequisite,
				new Set([...path, key]),
				undefined,
				true,
			);
			if (result.issue) return result;
			staged.push(...result.requirements);
		}
		return { requirements: staged.length ? staged : missing };
	};
	return (
		query: QueryDescriptor,
		forced?: readonly string[],
		mandatory = false,
	) => resolve(query, new Set(), forced, mandatory);
}
