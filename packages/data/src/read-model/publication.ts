// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { equal } from "../values.js";
import type {
	ReadModelMembership,
	ReadModelRecord,
	ReadModelSnapshot,
} from "./types.js";

interface KeyedDelta<T> {
	upsert: readonly T[];
	remove: readonly string[];
}

export interface ReadModelDelta {
	revision: number;
	records: KeyedDelta<ReadModelRecord>;
	memberships: KeyedDelta<ReadModelMembership>;
}

// Weak keys preserve transition reuse without retaining obsolete disclosed snapshots.
const changes = new WeakMap<
	ReadModelSnapshot,
	WeakMap<ReadModelSnapshot, ReadModelDelta>
>();

export function rememberReadModelChanges(
	previous: ReadModelSnapshot,
	next: ReadModelSnapshot,
	update: ReadModelDelta,
): void {
	let following = changes.get(previous);
	if (!following) {
		following = new WeakMap();
		changes.set(previous, following);
	}
	following.set(next, update);
}

export function readModelChanges(
	previous: ReadModelSnapshot,
	next: ReadModelSnapshot,
): ReadModelDelta | undefined {
	if (previous === next)
		return {
			revision: next.revision,
			records: { upsert: [], remove: [] },
			memberships: { upsert: [], remove: [] },
		};
	return changes.get(previous)?.get(next);
}

export const emptyReadModel = (): ReadModelSnapshot => ({
	revision: 0,
	records: [],
	memberships: [],
});

function delta<T extends { key: string }>(
	previous: readonly T[],
	next: readonly T[],
): KeyedDelta<T> {
	if (previous === next) return { upsert: [], remove: [] };
	const before = new Map(previous.map((value) => [value.key, value]));
	const keys = new Set(next.map((value) => value.key));
	return {
		upsert: next.filter((value) => {
			const prior = before.get(value.key);
			return !equal(prior, value);
		}),
		remove: previous
			.filter((value) => !keys.has(value.key))
			.map((value) => value.key),
	};
}

export function readModelDelta(
	previous: ReadModelSnapshot,
	next: ReadModelSnapshot,
	reset: boolean,
): ReadModelDelta {
	if (reset)
		return {
			revision: next.revision,
			records: { upsert: next.records, remove: [] },
			memberships: { upsert: next.memberships, remove: [] },
		};
	const known = readModelChanges(previous, next);
	if (known) return known;
	const update = {
		revision: next.revision,
		records: delta(previous.records, next.records),
		memberships: delta(previous.memberships, next.memberships),
	};
	rememberReadModelChanges(previous, next, update);
	return update;
}

function apply<T extends { key: string }>(
	previous: readonly T[],
	update: KeyedDelta<T>,
	reset: boolean,
): readonly T[] {
	if (!reset && update.remove.length === 0 && update.upsert.length === 0)
		return previous;
	const values = new Map(
		(reset ? [] : previous).map((value) => [value.key, value]),
	);
	for (const key of update.remove) values.delete(key);
	for (const value of update.upsert) values.set(value.key, value);
	return [...values.values()];
}

export function applyReadModel(
	previous: ReadModelSnapshot,
	update: ReadModelDelta,
	reset: boolean,
): ReadModelSnapshot {
	const records = apply(previous.records, update.records, reset);
	const memberships = apply(previous.memberships, update.memberships, reset);
	if (
		previous.revision === update.revision &&
		records === previous.records &&
		memberships === previous.memberships
	)
		return previous;
	const next = { revision: update.revision, records, memberships };
	if (!reset) rememberReadModelChanges(previous, next, update);
	return next;
}
