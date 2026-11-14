// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { freezeValue, stableKey } from "./descriptors.js";
import {
	type FilterExpression,
	filter,
	isFilterExpression,
	matchesFilter,
	type TextComparison,
} from "./filters.js";
import type { Values } from "./types.js";

/** A literal substring; comparison defaults to case-sensitive and accent-sensitive. */
export interface TextCondition extends Partial<TextComparison> {
	readonly contains: string;
}
/** Scalar values use equality shorthand; object and array equality requires an explicit eq. */
export type FieldCondition<V> =
	| Extract<V, string | number | boolean | null | undefined>
	| {
			readonly eq: V;
			readonly contains?: never;
			readonly case?: never;
			readonly accents?: never;
	  }
	| (NonNullable<V> extends string
			? TextCondition & { readonly eq?: never }
			: never);
/** Fields are ANDed; $and and $or combine nested conditions without selecting their fields. */
export type Where<T extends object> = {
	readonly [K in Exclude<keyof T & string, `$${string}`>]?: FieldCondition<
		T[K]
	>;
} & {
	readonly $and?: readonly Where<T>[];
	readonly $or?: readonly Where<T>[];
};

function plain(value: unknown): value is Values {
	return (
		value !== null &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}
function junction(
	kind: "all" | "any",
	conditions: readonly FilterExpression[],
): FilterExpression {
	const entries = new Map<string, FilterExpression>();
	for (const condition of conditions) {
		const parts =
			condition.$filter === kind ? condition.conditions : [condition];
		for (const part of parts) entries.set(stableKey(part), part);
	}
	const ordered = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const first = ordered[0];
	if (ordered.length === 1 && first) return first[1];
	return filter[kind](...ordered.map(([, condition]) => condition));
}
function condition(field: string, input: unknown): FilterExpression {
	if (input === null || typeof input !== "object") {
		stableKey(input);
		return filter.equal(field, input);
	}
	if (!plain(input))
		throw new TypeError(
			`Use { eq: value } to compare an object or array in where.${field}`,
		);
	const keys = Object.keys(input);
	if (Object.hasOwn(input, "eq") && keys.length === 1) {
		stableKey(input.eq);
		return filter.equal(field, input.eq);
	}
	if (
		typeof input.contains === "string" &&
		keys.every((key) => ["contains", "case", "accents"].includes(key)) &&
		(input.case === undefined ||
			input.case === "sensitive" ||
			input.case === "insensitive") &&
		(input.accents === undefined ||
			input.accents === "sensitive" ||
			input.accents === "insensitive")
	)
		return filter.contains(field, input.contains, {
			case: input.case ?? "sensitive",
			accents: input.accents ?? "sensitive",
		});
	throw new TypeError(
		`Invalid condition in where.${field}; use eq or contains`,
	);
}
function expression(where: Readonly<Values>): FilterExpression {
	if (isFilterExpression(where)) return where;
	if (!plain(where)) throw new TypeError("where must be a plain object");
	const conditions: FilterExpression[] = [];
	for (const [field, input] of Object.entries(where)) {
		if (field === "$and" || field === "$or") {
			if (!Array.isArray(input))
				throw new TypeError(`${field} must contain an array of where objects`);
			conditions.push(
				junction(
					field === "$and" ? "all" : "any",
					input.map((part) => {
						if (!plain(part))
							throw new TypeError(`${field} must contain where objects`);
						return expression(part);
					}),
				),
			);
		} else {
			if (field.startsWith("$"))
				throw new TypeError(`Unknown where operator: ${field}`);
			conditions.push(condition(field, input));
		}
	}
	return junction("all", conditions);
}
/** Compile public conditions once; runtime descriptors and source evidence retain their existing representation. */
export function normalizeWhere(
	where: Readonly<Values> | undefined,
): Readonly<Values> | undefined {
	if (where === undefined) return undefined;
	const normalized = expression(where);
	const parts =
		normalized.$filter === "all" ? normalized.conditions : [normalized];
	const equalities = new Map<string, unknown>();
	for (const part of parts) {
		if (
			part.$filter !== "equal" ||
			(part.value !== null && typeof part.value === "object") ||
			(equalities.has(part.field) &&
				stableKey(equalities.get(part.field)) !== stableKey(part.value))
		)
			return freezeValue(structuredClone(normalized));
		equalities.set(part.field, part.value);
	}
	return freezeValue(Object.fromEntries(equalities));
}
/** Evaluate public where conditions against known values; an absent field remains unknown. */
export function matchesWhere<T extends object>(
	values: Readonly<Partial<T>>,
	where: Where<NoInfer<T>> | undefined,
): boolean | "unknown" {
	return matchesFilter(values as Readonly<Values>, normalizeWhere(where));
}
