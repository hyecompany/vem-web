// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	combineOptions,
	type SelectionCandidate,
	selectAcquisitions,
} from "../../src/runtime/planning-selection.js";

const options = (...keys: string[]) => keys.map((key) => new Set([key]));
const candidates = (values: SelectionCandidate[]) =>
	new Map(values.map((value) => [value.key, value]));

test("selection keeps bounded detail work ahead of an unknown collection", () => {
	const detail = Array.from({ length: 12 }, (_, index) => ({
		key: `detail-${index}`,
		cost: [0, 0, 0, 4, 1, 0, 0] as const,
	}));
	const choices = candidates([
		...detail,
		{ key: "bulk", cost: [1, 4, 0, 0, 1, 0, 0] },
	]);
	const selected = selectAcquisitions(
		detail.map((item) => ({ options: options(item.key, "bulk") })),
		choices,
	);
	assert.deepEqual([...selected].sort(), detail.map((item) => item.key).sort());
});

test("selection combines equal response demand and avoids known surplus identities", () => {
	const detail = Array.from({ length: 5 }, (_, index) => ({
		key: `detail-${index}`,
		cost: [0, 0, 0, 4, 1, 0, 0] as const,
	}));
	const demands = detail.map((item) => ({
		options: options(item.key, "bulk"),
	}));
	assert.deepEqual(
		[
			...selectAcquisitions(
				demands,
				candidates([...detail, { key: "bulk", cost: [0, 0, 0, 20, 1, 0, 0] }]),
			),
		],
		["bulk"],
	);
	const selected = selectAcquisitions(
		demands,
		candidates([...detail, { key: "bulk", cost: [0, 0, 0, 2000, 1, 495, 0] }]),
	);
	assert.deepEqual([...selected].sort(), detail.map((item) => item.key).sort());
});

test("uncertain inventory alternatives prefer narrower information and reuse accepted work", () => {
	const choices = candidates([
		{ key: "urls", cost: [1, 1, 0, 0, 1, 0, 0] },
		{ key: "representations", cost: [1, 4, 0, 0, 1, 0, 0] },
	]);
	assert.deepEqual(
		[
			...selectAcquisitions(
				[{ options: options("urls", "representations") }],
				choices,
			),
		],
		["urls"],
	);
	choices.set("inflight", { key: "inflight", cost: 0 });
	assert.deepEqual(
		[
			...selectAcquisitions(
				[{ options: options("urls", "representations", "inflight") }],
				choices,
			),
		],
		["inflight"],
	);
});

test("declared scalar costs and compound dependency choices retain joint planning", () => {
	const choices = candidates([
		{ key: "left", cost: 2 },
		{ key: "right", cost: 2 },
		{ key: "shared", cost: 3 },
		{ key: "dependency", cost: 1 },
	]);
	const combined = combineOptions(
		[options("left", "shared"), options("right", "shared")],
		choices,
	);
	const selected = selectAcquisitions(
		[{ options: combined }, { options: options("dependency") }],
		choices,
	);
	assert.deepEqual([...selected].sort(), ["dependency", "shared"]);
});
