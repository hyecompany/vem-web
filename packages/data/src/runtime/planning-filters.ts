// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { isFilterExpression } from "../filters.js";
import type { Values } from "../types.js";
import { equal } from "../values.js";

/** Broaden actual simultaneous predicates; bound intersections instead of enumerating arbitrary filter subsets. */
export function broaderFilters(
	requested: readonly Readonly<Values>[],
): readonly Readonly<Values>[] {
	const originals = new Map(
		requested.map((where) => [stableKey(where), where]),
	);
	const known = new Map(originals);
	const alternatives = new Map<string, Readonly<Values>>([[stableKey({}), {}]]);
	const pending = [...originals.values()];
	let comparisons = 0;
	for (let left = 0; left < pending.length && alternatives.size < 32; left++) {
		for (
			let right = left + 1;
			right < pending.length && alternatives.size < 32 && comparisons < 512;
			right++
		) {
			comparisons++;
			const first = pending[left] ?? {},
				second = pending[right] ?? {};
			if (isFilterExpression(first) || isFilterExpression(second)) continue;
			const common = Object.fromEntries(
				Object.entries(first).filter(
					([field, value]) =>
						Object.hasOwn(second, field) && equal(value, second[field]),
				),
			);
			const key = stableKey(common);
			if (known.has(key)) continue;
			known.set(key, common);
			alternatives.set(key, common);
			pending.push(common);
		}
		if (comparisons >= 512) break;
	}
	return [...alternatives]
		.filter(([key]) => !originals.has(key))
		.map(([, where]) => where);
}
