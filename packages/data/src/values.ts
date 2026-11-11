// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { freezeValue } from "./descriptors.js";
import type { Values } from "./types.js";
export const equal = (left: unknown, right: unknown): boolean => {
	if (Object.is(left, right)) return true;
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	)
		return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const a = Object.keys(left),
		b = Object.keys(right);
	return (
		a.length === b.length &&
		a.every(
			(key) =>
				Object.hasOwn(right, key) &&
				equal((left as Values)[key], (right as Values)[key]),
		)
	);
};
export const frozen = <T>(value: T): T => freezeValue(value);
