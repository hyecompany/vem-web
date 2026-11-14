// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	asFilterExpression,
	type FilterCapabilities,
	type FilterExpression,
	filter,
	filterEqualities,
	filterFields,
	isFilterExpression,
} from "../filters.js";
import type { AcquisitionSource, ResourceContext, Values } from "../types.js";
import { equal } from "../values.js";

function capabilities(source: AcquisitionSource): FilterCapabilities {
	const declared = source.filters;
	return Array.isArray(declared)
		? { fields: declared, operators: ["equal"], combinations: ["all"] }
		: ((declared as FilterCapabilities | undefined) ?? {
				fields: [],
				operators: [],
			});
}
/** Keep only supported conjuncts; dropping an OR branch would exclude requested matches. */
export function sourceFilter(
	source: AcquisitionSource,
	where: Readonly<Values> | undefined,
	context?: ResourceContext,
): Readonly<Values> | undefined {
	if (!where) return undefined;
	const supported = capabilities(source);
	const accepts = (expression: FilterExpression): boolean => {
		if (expression.$filter === "all" || expression.$filter === "any")
			return (
				supported.combinations?.includes(expression.$filter) === true &&
				expression.conditions.every(accepts)
			);
		return (
			supported.fields.includes(expression.field) &&
			supported.operators.includes(expression.$filter) &&
			(expression.$filter !== "contains" ||
				supported.text?.some((comparison) =>
					equal(comparison, expression.comparison),
				) === true)
		);
	};
	const accepted = (expression: FilterExpression) =>
		accepts(expression) &&
		(!supported.supports ||
			(context !== undefined && supported.supports(expression, context)));
	const expression = asFilterExpression(where);
	let chosen = accepted(expression) ? expression : undefined;
	if (!chosen && expression.$filter === "all") {
		const conditions = expression.conditions.filter(accepted);
		if (conditions.length === 1) chosen = conditions[0];
		else if (conditions.length > 1) {
			const combined = filter.all(...conditions);
			if (accepted(combined)) chosen = combined;
		}
	}
	if (!chosen || filterFields(chosen).length === 0) return undefined;
	if (Array.isArray(source.filters)) return filterEqualities(chosen);
	if (!isFilterExpression(where)) {
		const fields = new Set(filterFields(chosen));
		return Object.fromEntries(
			Object.entries(where).filter(([field]) => fields.has(field)),
		);
	}
	return chosen;
}
