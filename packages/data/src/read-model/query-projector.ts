// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryDescriptor, QueryIssue, QueryResult } from "../types.js";
import { equal } from "../values.js";
import { QueryCalculation } from "./query-calculation.js";
import { QueryChanges } from "./query-changes.js";
import { QueryMatching } from "./query-matching.js";
import { QueryRequirements } from "./query-requirements.js";
import type { ProjectionState, QueryKnowledge } from "./query-types.js";
import type { MissingRequirement } from "./requirements.js";

export class QueryProjection {
	private calculations = new WeakMap<QueryDescriptor, QueryCalculation>();
	private readonly changes = new QueryChanges();
	private readonly matching: QueryMatching;
	private readonly acquisition: QueryRequirements;

	constructor(
		private readonly host: QueryKnowledge,
		onMembership?: (key: string) => void,
	) {
		this.matching = new QueryMatching(host, onMembership);
		this.acquisition = new QueryRequirements(host, this.matching);
	}

	changed(keys: Iterable<string>, reset = false): void {
		if (reset) {
			this.calculations = new WeakMap();
			this.changes.reset();
		} else this.changes.changed(keys);
	}

	membershipEvidence(
		state: ProjectionState,
		memberships = this.host.memberships(),
	): ReadonlySet<string> {
		const keys = new Set<string>();
		new QueryProjection(
			{ ...this.host, memberships: () => memberships },
			(key) => keys.add(key),
		).snapshot(state);
		return keys;
	}

	private calculation(descriptor: QueryDescriptor): QueryCalculation {
		let calculation = this.calculations.get(descriptor);
		const changes = calculation && this.changes.since(calculation.revision);
		if (!calculation || changes === undefined) {
			calculation = new QueryCalculation(
				descriptor,
				this.host,
				this.matching,
				this.acquisition,
			);
			this.calculations.set(descriptor, calculation);
		} else {
			calculation.update(changes);
		}
		calculation.revision = this.changes.revision;
		return calculation;
	}

	/** Missing confirmed evidence; proposals never satisfy acquisition requirements. */
	requirements(
		descriptor: QueryDescriptor,
		forcedFields: readonly string[] = [],
	): MissingRequirement[] {
		return this.calculation(descriptor).requirements(forcedFields);
	}

	accessIssues(descriptor: QueryDescriptor): QueryIssue[] {
		return this.calculation(descriptor).accessIssues();
	}

	snapshot(state: ProjectionState): QueryResult {
		const descriptor = state.descriptor;
		const calculation = this.calculation(descriptor);
		const { rows, unresolved } = calculation.rows();
		const coverage = this.matching.coverage(descriptor);
		if (descriptor.mode === "list" && coverage) this.matching.uses(coverage);
		const actual =
			descriptor.mode === "one"
				? this.host.records.get(
						this.host.recordKey(descriptor.resource, descriptor.identity),
					)
				: undefined;
		const presence =
			descriptor.mode === "one"
				? this.host.cells.get(
						this.host.factKey({
							resource: descriptor.resource,
							identity: descriptor.identity,
							field: "$presence",
						}),
					)
				: undefined;
		const complete =
			descriptor.mode === "one"
				? !presence?.stale &&
					(actual?.presence === "present" || actual?.presence === "absent")
				: coverage !== undefined && calculation.unknown === 0;
		const exists =
			descriptor.mode === "one" && !presence?.stale
				? actual?.presence === "present"
					? true
					: actual?.presence === "absent"
						? false
						: undefined
				: undefined;
		const requirements = calculation.requirements(
			state.attempted < state.forced ? (descriptor.sample?.fields ?? []) : [],
		);
		const stale = requirements.some((requirement) => requirement.stale);
		const value: QueryResult = {
			rows,
			unresolved,
			confirmed: {
				complete,
				knownCount: calculation.count,
				total: complete ? calculation.count : undefined,
			},
			activities: this.host
				.activities()
				.filter(
					(action) =>
						calculation.projectedActivities.has(action.id) ||
						(
							action.references ?? [
								{ resource: action.resource, identity: action.target },
							]
						).some(
							(ref) =>
								ref.resource === descriptor.resource &&
								(descriptor.mode === "one"
									? equal(ref.identity, descriptor.identity)
									: this.matching.activityScope(
											descriptor,
											ref.identity,
											this.host.records.get(
												this.host.recordKey(ref.resource, ref.identity),
											),
										)),
						),
				),
			stale,
			revalidating:
				stale &&
				(state.revalidating ??
					this.host.revalidating?.(descriptor, requirements) ??
					false),
			fetching: state.fetching > 0,
			settled:
				state.fetching === 0 &&
				(state.attempted >= state.version || requirements.length === 0),
			empty:
				complete &&
				calculation.count === 0 &&
				rows.length === 0 &&
				unresolved.length === 0,
			exists,
			issues: [...state.issues, ...calculation.accessIssues()],
			revision: this.host.revision(),
		};
		const previous = calculation.snapshot;
		if (
			previous &&
			previous.rows === rows &&
			previous.unresolved === unresolved &&
			equal({ ...previous, revision: 0 }, { ...value, revision: 0 })
		)
			return previous;
		calculation.snapshot = value;
		return value;
	}

	needs(state: ProjectionState, _values?: unknown): boolean {
		return (
			this.requirements(
				state.descriptor,
				state.attempted < state.forced
					? (state.descriptor.sample?.fields ?? [])
					: [],
			).length > 0
		);
	}
}
