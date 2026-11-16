// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { freezeValue } from "./descriptors.js";
import type { ResourceContext, Values } from "./types.js";
import { equal } from "./values.js";

export interface TextComparison {
	/** Unicode simple case folding, independent of the user's locale. Defaults to sensitive. */
	case: "sensitive" | "insensitive";
	/** Insensitive removes Unicode combining marks after canonical decomposition. Defaults to sensitive. */
	accents: "sensitive" | "insensitive";
}
export interface EqualFilter<F extends string = string, V = unknown>
	extends Readonly<Values> {
	readonly $filter: "equal";
	readonly field: F;
	readonly value: V;
}
export interface ContainsFilter<F extends string = string>
	extends Readonly<Values> {
	readonly $filter: "contains";
	readonly field: F;
	readonly value: string;
	readonly comparison: Readonly<TextComparison>;
}
export interface LogicalFilter<
	C extends FilterExpression,
	K extends "all" | "any",
> extends Readonly<Values> {
	readonly $filter: K;
	readonly conditions: readonly C[];
}
export type CombinedFilter<C extends FilterExpression = FilterExpression> =
	| LogicalFilter<C, "all">
	| LogicalFilter<C, "any">;
/** A serializable predicate; domain adapters can inspect the discriminant to encode supported backend filters. */
export type FilterExpression =
	| EqualFilter
	| ContainsFilter
	| LogicalFilter<FilterExpression, "all">
	| LogicalFilter<FilterExpression, "any">;
export interface FilterCapabilities {
	fields: readonly string[];
	operators: readonly ("equal" | "contains")[];
	combinations?: readonly ("all" | "any")[];
	/** Exact comparison semantics supported by the source; omitted means contains is unsupported. */
	text?: readonly Readonly<TextComparison>[];
	/** Further restrict the full expression, for example by extension support or backend grouping syntax. */
	supports?(expression: FilterExpression, context: ResourceContext): boolean;
}

/** Pure descriptions; construction never acquires information. */
export const filter = {
	equal<const F extends string, const V>(
		field: F,
		value: V,
	): EqualFilter<F, V> {
		return freezeValue({
			$filter: "equal",
			field,
			value: structuredClone(value),
		});
	},
	contains<const F extends string>(
		field: F,
		value: string,
		comparison: Partial<TextComparison> = {},
	): ContainsFilter<F> {
		return freezeValue({
			$filter: "contains",
			field,
			value,
			comparison: { case: "sensitive", accents: "sensitive", ...comparison },
		});
	},
	all<const C extends readonly FilterExpression[]>(
		...conditions: C
	): LogicalFilter<C[number], "all"> {
		return freezeValue({ $filter: "all", conditions: [...conditions] });
	},
	any<const C extends readonly FilterExpression[]>(
		...conditions: C
	): LogicalFilter<C[number], "any"> {
		return freezeValue({ $filter: "any", conditions: [...conditions] });
	},
};
export function isFilterExpression(value: unknown): value is FilterExpression {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const where = value as Values;
	if (where.$filter === "all" || where.$filter === "any")
		return (
			Array.isArray(where.conditions) &&
			where.conditions.every(isFilterExpression)
		);
	if (typeof where.field !== "string") return false;
	if (where.$filter === "equal") return Object.hasOwn(where, "value");
	if (where.$filter !== "contains" || typeof where.value !== "string")
		return false;
	const comparison = where.comparison as TextComparison | undefined;
	return (
		comparison !== undefined &&
		comparison !== null &&
		(comparison.case === "sensitive" || comparison.case === "insensitive") &&
		(comparison.accents === "sensitive" || comparison.accents === "insensitive")
	);
}
export function filterFields(
	where: Readonly<Values> | undefined,
): readonly string[] {
	if (!isFilterExpression(where)) return Object.keys(where ?? {});
	if (where.$filter === "equal" || where.$filter === "contains")
		return [where.field];
	return [...new Set(where.conditions.flatMap(filterFields))];
}
export function asFilterExpression(
	where: Readonly<Values> | undefined,
): FilterExpression {
	return isFilterExpression(where)
		? where
		: filter.all(
				...Object.entries(where ?? {}).map(([field, value]) =>
					filter.equal(field, value),
				),
			);
}
const patterns = new WeakMap<ContainsFilter, RegExp>();
function textValue(value: string, comparison: TextComparison): string {
	return comparison.accents === "insensitive"
		? value.normalize("NFD").replace(/\p{M}/gu, "")
		: value;
}
/** Three-valued evaluation preserves unknown fields; an established OR branch can still prove a match. */
export function matchesFilter(
	values: Readonly<Values>,
	where: Readonly<Values> | undefined,
): boolean | "unknown" {
	if (!isFilterExpression(where)) {
		let unknown = false;
		for (const [field, value] of Object.entries(where ?? {})) {
			if (!Object.hasOwn(values, field)) unknown = true;
			else if (!equal(values[field], value)) return false;
		}
		return unknown ? "unknown" : true;
	}
	if (where.$filter === "all" || where.$filter === "any") {
		const terminal = where.$filter === "any";
		let unknown = false;
		for (const condition of where.conditions) {
			const result = matchesFilter(values, condition);
			if (result === terminal) return terminal;
			if (result === "unknown") unknown = true;
		}
		return unknown ? "unknown" : !terminal;
	}
	if (!Object.hasOwn(values, where.field)) return "unknown";
	if (where.$filter === "equal") return equal(values[where.field], where.value);
	const actual = values[where.field];
	if (typeof actual !== "string") return false;
	let pattern = patterns.get(where);
	if (!pattern) {
		const literal = textValue(where.value, where.comparison).replace(
			/[.*+?^$(){}|[\]\\]/g,
			"\\$&",
		);
		pattern = new RegExp(
			literal,
			where.comparison.case === "insensitive" ? "iu" : "u",
		);
		patterns.set(where, pattern);
	}
	return pattern.test(textValue(actual, where.comparison));
}
/** Guaranteed equalities only; disjunctions and text conditions never manufacture field values. */
export function filterEqualities(
	where: Readonly<Values> | undefined,
): Readonly<Values> {
	if (!isFilterExpression(where)) return where ?? {};
	if (where.$filter === "equal") return { [where.field]: where.value };
	if (where.$filter !== "all") return {};
	return Object.assign({}, ...where.conditions.map(filterEqualities));
}
/** True only when the requested predicate implies the coverage predicate. */
export function filterCovers(
	coverage: Readonly<Values> | undefined,
	requested: Readonly<Values> | undefined,
): boolean {
	if (!isFilterExpression(coverage) && !isFilterExpression(requested))
		return Object.entries(coverage ?? {}).every(
			([field, value]) =>
				Object.hasOwn(requested ?? {}, field) &&
				equal(requested?.[field], value),
		);
	const covers = (
		broad: FilterExpression,
		narrow: FilterExpression,
	): boolean => {
		if (equal(broad, narrow)) return true;
		if (broad.$filter === "all")
			return broad.conditions.every((part) => covers(part, narrow));
		if (narrow.$filter === "any")
			return narrow.conditions.every((part) => covers(broad, part));
		if (broad.$filter === "any")
			return broad.conditions.some((part) => covers(part, narrow));
		if (narrow.$filter === "all")
			return narrow.conditions.some((part) => covers(broad, part));
		if (broad.field !== narrow.field) return false;
		if (narrow.$filter === "equal")
			return matchesFilter({ [narrow.field]: narrow.value }, broad) === true;
		return (
			broad.$filter === "contains" &&
			equal(broad.comparison, narrow.comparison) &&
			matchesFilter({ [broad.field]: narrow.value }, broad) === true
		);
	};
	return covers(asFilterExpression(coverage), asFilterExpression(requested));
}
