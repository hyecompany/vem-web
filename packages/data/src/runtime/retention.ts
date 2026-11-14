// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionRegistry } from "../actions.js";
import type { QueryProjection } from "../read-model/query-projector.js";
import type { ReadModelMembership } from "../read-model/types.js";
import type { ResourceDefinition, RuntimeOptions } from "../types.js";
import type { KnowledgeStore } from "./knowledge.js";
import type { PresentationIndex } from "./presentation.js";
import type { QueryRegistry } from "./queries.js";
import type { Restoration } from "./restoration.js";

interface RetentionHost {
	knowledge: KnowledgeStore;
	presentation: PresentationIndex;
	queries: QueryRegistry;
	projection: QueryProjection;
	memberships(): readonly ReadModelMembership[];
	restoration: Restoration;
	activities: ActionRegistry;
	options: RuntimeOptions;
	definition(resource: string): ResourceDefinition;
	rebuildEffective(): void;
	changed(): void;
}
export function trimKnowledge(host: RetentionHost): void {
	const inactive: string[] = [];
	const references = host.activities
		.list()
		.filter(
			(action) =>
				action.phase !== "settled" || action.outcome?.kind === "unknown",
		)
		.flatMap((action) => action.references ?? []);
	const inspect =
		host.knowledge.retentionDirty &&
		host.knowledge.cellsByRecord.size >
			(host.options.maxInactiveRecords ?? 10000);
	host.knowledge.retentionDirty = false;
	for (const key of inspect ? host.knowledge.cellsByRecord.keys() : []) {
		const fieldKey = host.knowledge.cellsByRecord
			.get(key)
			?.values()
			.next().value;
		const cell = fieldKey ? host.knowledge.cells.get(fieldKey) : undefined;
		if (!cell) continue;
		const record = host.knowledge.records.get(key);
		const demanded = [...host.queries.states.values()].some(
			(query) =>
				(query.active || query.users > 0) &&
				query.descriptor.resource === cell.resource &&
				(query.descriptor.mode === "one"
					? host.knowledge.recordKey(
							cell.resource,
							query.descriptor.identity,
						) === key
					: query.descriptor.scope === undefined ||
						host
							.definition(cell.resource)
							.inScope?.(
								cell.identity,
								query.descriptor.scope,
								record?.values ?? {},
							) !== false),
		);
		if (
			!demanded &&
			!references.some(
				(ref) =>
					ref.resource === cell.resource &&
					host.knowledge.recordKey(ref.resource, ref.identity) === key,
			) &&
			!host.presentation.projectionKeys.has(key) &&
			!host.presentation.derivedProjectionKeys.has(key)
		)
			inactive.push(key);
	}
	const removed = inactive.slice(
		0,
		Math.max(0, inactive.length - (host.options.maxInactiveRecords ?? 10000)),
	);
	for (const key of removed) {
		for (const field of [...(host.knowledge.cellsByRecord.get(key) ?? [])])
			host.knowledge.dropCell(field);
		host.presentation.aliases.delete(key);
	}
	if (removed.length > 0) {
		const removedKeys = new Set(removed);
		for (const [key, membership] of host.knowledge.memberships)
			if (
				membership.identities.some((identity) =>
					removedKeys.has(
						host.knowledge.recordKey(membership.resource, identity),
					),
				)
			)
				host.knowledge.memberships.delete(key);
		host.knowledge.rebuildRecords();
		host.rebuildEffective();
		host.changed();
	}
	const membershipLimit = host.options.maxInactiveQueries ?? 100;
	if (host.knowledge.memberships.size > membershipLimit) {
		const supported = new Set<string>();
		const memberships = host.memberships();
		for (const state of host.queries.states.values())
			if (state.active)
				for (const key of host.projection.membershipEvidence(
					state,
					memberships,
				))
					supported.add(key);
		const inactive = [...host.knowledge.memberships.values()].filter(
			(membership) => !supported.has(membership.key),
		);
		for (const membership of inactive.slice(
			0,
			Math.max(0, inactive.length - membershipLimit),
		)) {
			host.knowledge.memberships.delete(membership.key);
			host.changed();
		}
	}
	const quarantineLimit = host.options.maxInactiveRecords ?? 10000;
	const quarantineKeys = [
		...new Set(
			host.restoration.quarantinedFacts.map((fact) =>
				host.knowledge.recordKey(fact.resource, fact.identity),
			),
		),
	];
	if (quarantineKeys.length > quarantineLimit) {
		const retained = new Set(
			quarantineLimit === 0 ? [] : quarantineKeys.slice(-quarantineLimit),
		);
		host.restoration.quarantinedFacts =
			host.restoration.quarantinedFacts.filter((fact) =>
				retained.has(host.knowledge.recordKey(fact.resource, fact.identity)),
			);
	}
	host.restoration.quarantinedMemberships =
		membershipLimit === 0
			? []
			: host.restoration.quarantinedMemberships.slice(-membershipLimit);
}
