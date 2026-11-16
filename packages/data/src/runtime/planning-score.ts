// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/** Ordered policy dimensions, not exchange rates between requests, fields, and backend work. */
export type SelectionScore = readonly [
	unbounded: number,
	unboundedWidth: number,
	work: number,
	extent: number,
	requests: number,
	surplus: number,
	width: number,
];
export type SelectionCost = number | SelectionScore;

export const zeroScore: SelectionScore = [0, 0, 0, 0, 0, 0, 0];
export const impossibleScore: SelectionScore = [
	Infinity,
	Infinity,
	Infinity,
	Infinity,
	Infinity,
	Infinity,
	Infinity,
];

function score(value: SelectionCost): SelectionScore {
	return typeof value === "number" ? [0, 0, value, 0, 0, 0, 0] : value;
}

export function compareCosts(
	left: SelectionCost,
	right: SelectionCost,
): number {
	const a = score(left);
	const b = score(right);
	for (let index = 0; index < a.length; index++) {
		const first = a[index] ?? 0;
		const second = b[index] ?? 0;
		if (first < second) return -1;
		if (first > second) return 1;
	}
	return 0;
}

export function addCosts(
	left: SelectionCost,
	right: SelectionCost,
): SelectionScore {
	const a = score(left);
	const b = score(right);
	return [
		a[0] + b[0],
		a[1] + b[1],
		a[2] + b[2],
		a[3] + b[3],
		a[4] + b[4],
		a[5] + b[5],
		a[6] + b[6],
	];
}

export function divideCost(
	value: SelectionCost,
	divisor: number,
): SelectionScore {
	const parts = score(value);
	return [
		parts[0] / divisor,
		parts[1] / divisor,
		parts[2] / divisor,
		parts[3] / divisor,
		parts[4] / divisor,
		parts[5] / divisor,
		parts[6] / divisor,
	];
}
