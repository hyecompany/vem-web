// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type {
	EvidenceRef,
	KnownRelationship,
	PersistedFact,
	RelationshipObservation,
	RelationshipRef,
} from "../types.js";
import { frozen } from "../values.js";
import { type ContinuitySnapshot, combineCurrency } from "./continuity.js";
import type { KnowledgeStore } from "./knowledge.js";
import type { Cell } from "./state.js";

export function cellRef(cell: Cell): EvidenceRef {
	return cell.kind === "relationship"
		? {
				resource: cell.resource,
				identity: cell.identity,
				relationship: cell.field,
				...(cell.relationshipTarget ? { target: cell.relationshipTarget } : {}),
			}
		: { resource: cell.resource, identity: cell.identity, field: cell.field };
}

export function relationshipCells(
	store: KnowledgeStore,
	ref: RelationshipRef,
): Cell[] {
	return [
		...(store.cellsByRecord.get(store.recordKey(ref.resource, ref.identity)) ??
			[]),
	]
		.map((key) => store.cells.get(key))
		.filter(
			(cell): cell is Cell =>
				cell?.kind === "relationship" && cell.field === ref.relationship,
		);
}

export function knownRelationship(
	store: KnowledgeStore,
	ref: RelationshipRef,
): KnownRelationship | undefined {
	const cells = relationshipCells(store, ref).filter((cell) =>
		store.valid(cell),
	);
	if (cells.length === 0) return undefined;
	const marker = cells.find((cell) => cell.relationshipTarget === undefined);
	const stale =
		cells.some((cell) => cell.stale) ||
		(!marker && store.invalidations.has(store.factKey(ref)));
	const targets = cells.flatMap((cell) =>
		cell.relationshipTarget ? [cell.relationshipTarget] : [],
	);
	const complete = marker?.value as
		| { complete?: boolean; targets?: readonly unknown[] }
		| undefined;
	const targetKeys = new Set(targets.map(stableKey));
	const expected = (complete?.targets ?? []).map(stableKey);
	return frozen({
		targets,
		complete:
			complete?.complete === true &&
			!stale &&
			expected.length === targetKeys.size &&
			expected.every((key) => targetKeys.has(key)),
		liveness: stale
			? "snapshot"
			: combineCurrency(
					cells.map((cell) => store.currency(cell)),
					"all",
				).liveness,
		stale,
	});
}

export function ingestRelationship(
	store: KnowledgeStore,
	observation: RelationshipObservation,
	changed: EvidenceRef[],
	persisted: PersistedFact[],
	continuity?: ContinuitySnapshot,
): void {
	const dependencies = (observation.dependsOn ?? [])
		.flatMap((ref) => store.dependencyKeys(ref))
		.map((key) => store.cells.get(key));
	if (dependencies.some((cell) => !cell || !store.valid(cell))) return;
	const bases = store.basis(
		observation.basis ?? dependencies.flatMap((cell) => cell?.bases ?? []),
	);
	const targetBasis = new Map(
		(observation.targetBasis ?? []).map((entry) => [
			stableKey(entry.target),
			entry.basis,
		]),
	);
	if (
		bases.length === 0 &&
		![...targetBasis.values()].some((basis) => store.basis(basis).length > 0)
	)
		return;
	const previous = knownRelationship(store, observation);
	const previousKeys = new Set(
		relationshipCells(store, observation).map((cell) => cell.key),
	);
	const targets = [
		...new Map(
			observation.targets.map((target) => [stableKey(target), target]),
		).values(),
	];
	const included = new Set(targets.map(stableKey));
	const replacedBases = new Set(bases.map(stableKey));
	const removed = new Set((observation.removed ?? []).map(stableKey));
	if (bases.length > 0 && (observation.complete || removed.size > 0)) {
		for (const cell of relationshipCells(store, observation)) {
			if (
				!cell.relationshipTarget ||
				included.has(stableKey(cell.relationshipTarget))
			)
				continue;
			const explicitlyRemoved = removed.has(stableKey(cell.relationshipTarget));
			if (!observation.complete && !explicitlyRemoved) continue;
			const supports = explicitlyRemoved
				? []
				: cell.supports
						.map((support) => ({
							...support,
							bases: support.bases.filter(
								(basis) => !replacedBases.has(stableKey(basis)),
							),
						}))
						.filter((support) => support.bases.length > 0);
			const retained = supports.flatMap((support) => support.bases);
			if (stableKey(supports) === stableKey(cell.supports)) continue;
			const next = {
				...cell,
				supports,
				bases: retained,
				revision: ++store.revision,
			};
			if (retained.length) store.putCell(next);
			else store.dropCell(cell.key);
			store.touched.add(cell.key);
			store.invalidations.set(cell.key, store.revision);
			changed.push(cellRef(cell));
			persisted.push(
				retained.length
					? next
					: {
							...cell,
							deleted: true,
							value: undefined,
							revision: store.revision,
						},
			);
		}
	}
	for (const target of targets) {
		store.ingest(
			{
				resource: observation.resource,
				identity: observation.identity,
				values: { [observation.relationship]: target },
				basis: targetBasis.get(stableKey(target)) ?? observation.basis,
				dependsOn: observation.dependsOn,
				liveness: observation.liveness,
			},
			changed,
			persisted,
			{ name: observation.relationship, target },
			continuity,
		);
	}
	const markerBasis = observation.targetBasis
		? [
				{
					all: [
						{ any: bases },
						...targets.map((target) => ({
							any: store.basis(
								targetBasis.get(stableKey(target)) ??
									observation.basis ??
									dependencies.flatMap((cell) => cell?.bases ?? []),
							),
						})),
					],
				},
			]
		: observation.basis;
	store.ingest(
		{
			resource: observation.resource,
			identity: observation.identity,
			values: {
				[observation.relationship]: { complete: observation.complete, targets },
			},
			basis: markerBasis,
			dependsOn: observation.dependsOn,
			liveness: observation.liveness,
		},
		changed,
		persisted,
		{ name: observation.relationship },
		continuity,
	);
	const current = knownRelationship(store, observation);
	const truthKey = (value: KnownRelationship | undefined) =>
		value &&
		stableKey({
			...value,
			targets: value.targets.map(stableKey).sort(),
		});
	// Recertification fences older responses without restarting its own acquisition.
	if (truthKey(previous) !== truthKey(current)) {
		for (const cell of store.dependents(previousKeys))
			if (!cell.stale) store.invalidate(cellRef(cell));
	}
}
