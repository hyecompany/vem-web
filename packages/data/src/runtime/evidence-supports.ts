// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import { stableKey } from "../descriptors.js";
import type {
	ContinuityRef,
	DisclosureProof,
	EvidenceSupport,
} from "../types.js";
import {
	type ContinuityRegistry,
	type Currency,
	combineCurrency,
	continuityRoute,
} from "./continuity.js";
import type { Cell } from "./state.js";

export function mergeSupports<T extends EvidenceSupport>(
	supports: readonly T[],
	key: (value: unknown) => string = stableKey,
): T[] {
	return [
		...new Map(
			supports.map((support) => [
				key({
					...support,
					stale: undefined,
					liveness: continuityRoute(support.liveness),
				}),
				support,
			]),
		).values(),
	];
}

/** Permissions and currency are evaluated per independent observation, never mixed across supports. */
export class EvidenceSupports {
	constructor(
		private readonly grants: AccessRegistry,
		private readonly cells: ReadonlyMap<string, Cell>,
		private readonly continuity: ContinuityRegistry,
	) {}
	prune(cell: Cell): Cell | undefined {
		const supports = cell.supports
			.map((support) => ({
				...support,
				bases: this.grants
					.surviving(support.bases)
					.map((basis) => this.grants.adopt(basis)),
				disclosureDependencies: support.disclosureDependencies?.map((proof) =>
					this.grants.surviving(proof).map((basis) => this.grants.adopt(basis)),
				),
			}))
			.filter(
				(support) =>
					support.bases.length > 0 &&
					this.validDependencies(support, new Set([cell.key])),
			);
		if (
			!supports.some((support) =>
				this.validSupport(support, new Set([cell.key])),
			)
		)
			return undefined;
		const next = { ...cell, supports };
		return {
			...next,
			bases: [this.cellDisclosure(next)],
			...this.currency(next),
		};
	}
	validSupport(support: EvidenceSupport, path: Set<string>): boolean {
		return (
			this.grants.allowsAny(support.bases) &&
			this.validDependencies(support, path)
		);
	}
	private validDependencies(
		support: EvidenceSupport,
		path: Set<string>,
	): boolean {
		if (support.independentDisclosure) return true;
		if (support.disclosureDependencies)
			return support.disclosureDependencies.every((proof) =>
				this.grants.allowsAny(proof),
			);
		return support.dependencies.every((key) => {
			const dependency = this.cells.get(key);
			return dependency !== undefined && this.valid(dependency, path);
		});
	}
	valid(cell: Cell, path = new Set<string>()): boolean {
		if (path.has(cell.key)) return false;
		path.add(cell.key);
		const valid = cell.supports.some((support) =>
			this.validSupport(support, path),
		);
		path.delete(cell.key);
		return valid;
	}
	cellDisclosure(cell: Cell): DisclosureProof {
		return {
			any: cell.supports
				.filter((support) => this.validSupport(support, new Set([cell.key])))
				.map((support) => ({
					all: [
						{ any: this.grants.surviving(support.bases) },
						...(support.independentDisclosure
							? []
							: support.disclosureDependencies
								? support.disclosureDependencies.map((proof) => ({
										any: this.grants.surviving(proof),
									}))
								: support.dependencies.map((key) =>
										this.cellDisclosure(this.cells.get(key) as Cell),
									)),
					],
				})),
		};
	}
	currency(
		cell: Cell,
		path = new Set<string>(),
		memo = new Map<string, Currency>(),
	): Currency {
		const cached = memo.get(cell.key);
		if (cached) return cached;
		if (path.has(cell.key)) return { liveness: "snapshot", stale: true };
		path.add(cell.key);
		const result = this.supportCurrency(cell.supports, path, memo);
		path.delete(cell.key);
		memo.set(cell.key, result);
		return result;
	}
	supportCurrency(
		supports: readonly EvidenceSupport[],
		path = new Set<string>(),
		memo = new Map<string, Currency>(),
	): Currency {
		return combineCurrency(
			supports
				.filter((support) => this.validSupport(support, path))
				.map((support) => {
					const own = this.continuity.currency(support.liveness);
					return combineCurrency(
						[
							{ ...own, stale: own.stale || support.stale === true },
							...support.dependencies.map((key) => {
								const input = this.cells.get(key);
								return input
									? this.currency(input, path, memo)
									: { liveness: "snapshot" as const, stale: true };
							}),
						],
						"all",
					);
				}),
			"any",
		);
	}
	usesContinuity(
		cell: Cell,
		ref: ContinuityRef,
		memo: Map<string, boolean>,
		path = new Set<string>(),
	): boolean {
		const cached = memo.get(cell.key);
		if (cached !== undefined) return cached;
		if (path.has(cell.key)) return false;
		path.add(cell.key);
		const uses = cell.supports.some(
			(support) =>
				this.continuity.uses(support.liveness, ref) ||
				support.dependencies.some((key) => {
					const input = this.cells.get(key);
					return (
						input !== undefined && this.usesContinuity(input, ref, memo, path)
					);
				}),
		);
		path.delete(cell.key);
		memo.set(cell.key, uses);
		return uses;
	}
}
