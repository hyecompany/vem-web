// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { memoizedStableKey } from "./descriptors.js";
import type { ObservationBatch } from "./types.js";

/** A synchronous observation owns its proof snapshots; no memo survives publication. */
export class ObservationProofs {
	private readonly owned = new WeakSet<object>();
	private results = new Map<string, WeakMap<object, unknown>>();
	private fence = "";
	readonly key = memoizedStableKey(this.owned);
	constructor(readonly parent?: ObservationProofs) {}
	private own<T>(value: T): T {
		if (!value || typeof value !== "object" || this.owned.has(value))
			return value;
		this.owned.add(value);
		for (const child of Object.values(value)) this.own(child);
		Object.freeze(value);
		return value;
	}
	invalidate(): void {
		this.results.clear();
	}
	read<T>(
		operation: string,
		value: object,
		fence: string,
		calculate: () => T,
	): T {
		if (this.fence !== fence) {
			this.invalidate();
			this.fence = fence;
		}
		if (!this.owned.has(value)) return calculate();
		const results =
			this.results.get(operation) ?? new WeakMap<object, unknown>();
		if (results.has(value)) return results.get(value) as T;
		const result = this.own(calculate());
		results.set(value, result);
		this.results.set(operation, results);
		return result;
	}
	capture(batch: ObservationBatch): ObservationBatch {
		const proofs = this.own(
			structuredClone({
				facts: batch.facts?.map(({ basis, certifiedBasis, fieldBasis }) => ({
					basis,
					certifiedBasis,
					fieldBasis,
				})),
				memberships: batch.memberships?.map(({ basis }) => basis),
				identityTransitions: batch.identityTransitions?.map(
					({ basis }) => basis,
				),
				relationships: batch.relationships?.map(({ basis, targetBasis }) => ({
					basis,
					targetBasis,
				})),
			}),
		);
		return {
			...batch,
			facts: batch.facts?.map((fact, index) => ({
				...fact,
				...proofs.facts?.[index],
			})),
			memberships: batch.memberships?.map((membership, index) => ({
				...membership,
				basis: proofs.memberships?.[index],
			})),
			identityTransitions: batch.identityTransitions?.map(
				(transition, index) => ({
					...transition,
					basis: proofs.identityTransitions?.[index],
				}),
			),
			relationships: batch.relationships?.map((relationship, index) => ({
				...relationship,
				...proofs.relationships?.[index],
			})),
		};
	}
}
