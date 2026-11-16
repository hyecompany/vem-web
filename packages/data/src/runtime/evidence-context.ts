// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import { captureBasis, captureProof, mapProof } from "../access-proofs.js";
import { stableKey } from "../descriptors.js";
import { filterFields, isFilterExpression, matchesFilter } from "../filters.js";
import { fieldAccess } from "../read-model/access-requirements.js";
import type {
	AccessUpdate,
	DisclosureBasis,
	DisclosureProof,
	EvidenceRef,
	GrantRef,
	KnownMembership,
	KnownRecord,
	KnownRelationship,
	ObservationBatch,
	PersistedMembership,
	ResourceContext,
	ResourceDefinition,
	Values,
} from "../types.js";
import { equal } from "../values.js";
import type { ContinuityRegistry, ContinuitySnapshot } from "./continuity.js";
import {
	knownCollections,
	membershipInvalidationKey,
	membershipKey,
} from "./memberships.js";
import type { Cell } from "./state.js";

interface EvidenceHost {
	grants: AccessRegistry;
	readonly revision: number;
	readonly closed: boolean;
	cells: ReadonlyMap<string, Cell>;
	records: ReadonlyMap<string, KnownRecord>;
	identityRevision(resource: string, identity: unknown): number | undefined;
	memberships: ReadonlyMap<string, PersistedMembership>;
	relationship(
		resource: string,
		identity: unknown,
		name: string,
	): KnownRelationship | undefined;
	membership(
		resource: string,
		scope?: unknown,
		where?: Readonly<Values>,
	): KnownMembership | undefined;
	invalidations: ReadonlyMap<string, number>;
	continuity: ContinuityRegistry;
	disclosure(ref: EvidenceRef): DisclosureProof;
	definition(resource: string): ResourceDefinition;
	recordKey(resource: string, identity: unknown): string;
	factKey(ref: EvidenceRef): string;
	setAccess(update: AccessUpdate): void;
	observe(batch: ObservationBatch, continuity: ContinuitySnapshot): void;
	batch(work: () => void): void;
}
export function createResourceContext(
	host: EvidenceHost,
	signal: AbortSignal,
): ResourceContext {
	const generation = host.grants.contextGeneration;
	const start = host.revision;
	const continuity = host.continuity.snapshot();
	// Own synchronous writes may advance a fragment; unrelated revisions never do.
	const ownRevisions: { after: number; through: number }[] = [];
	const current = (revision = -1) =>
		revision <= start ||
		ownRevisions.some(
			(range) => revision > range.after && revision <= range.through,
		);
	const remember = (after: number) => {
		if (host.revision <= after) return;
		const last = ownRevisions.at(-1);
		if (last?.through === after) last.through = host.revision;
		else ownRevisions.push({ after, through: host.revision });
	};
	const captured = host.grants.snapshot();
	const ownGrants = new Map<string, GrantRef>();
	const ownBindings = new Map<string, unknown>();
	const blockedBindings = new Set<string>();
	const allowed = () =>
		!host.closed &&
		!signal.aborted &&
		generation === host.grants.contextGeneration;
	const capturedRef = (scope: string): GrantRef =>
		ownGrants.get(scope) ?? {
			...host.grants.ref(scope),
			generation: captured.scopes[scope]?.generation ?? 0,
			...(host.grants.contextIndependent(scope)
				? {}
				: { contextId: captured.contextId }),
		};
	const scopeCurrent = (scope: string) =>
		!host.grants.revoked(capturedRef(scope));
	const filterBasis = (basis: readonly DisclosureBasis[] | undefined) =>
		basis?.map((ref) =>
			mapProof(
				captureBasis(ref, (scope) =>
					scopeCurrent(scope) ? host.grants.ref(scope) : capturedRef(scope),
				),
				(leaf) =>
					blockedBindings.has(leaf.scope) ? { ...leaf, generation: -1 } : leaf,
			),
		);
	return {
		signal,
		disclosure: (ref) => {
			if (!allowed()) throw new Error("The evidence context has been retired.");
			const proof = mapProof(host.disclosure(ref), (leaf) =>
				scopeCurrent(leaf.scope) ? leaf : capturedRef(leaf.scope),
			);
			if (!host.grants.allowsAny([proof]))
				throw new Error("The evidence is no longer permitted in this context.");
			return proof;
		},
		proof: (requirement) =>
			captureProof(requirement, (scope) =>
				scopeCurrent(scope) ? host.grants.ref(scope) : capturedRef(scope),
			),
		accessContext: host.grants.contextId,
		authorityFence: stableKey([
			captured.epoch,
			generation,
			Object.entries(captured.scopes)
				.filter(([, scope]) => scope.generation > 1)
				.map(([scope, value]) => [scope, value.generation])
				.sort(([left], [right]) => String(left).localeCompare(String(right))),
		]),
		get acquisitionFence() {
			return stableKey([
				captured.epoch,
				generation,
				captured.revision,
				start,
				ownRevisions.at(-1)?.through,
			]);
		},
		get: (resource, identity) =>
			allowed()
				? host.records.get(host.recordKey(resource, identity))
				: undefined,
		records: (resource) =>
			allowed()
				? [...host.records.values()].filter(
						(record) => record.resource === resource,
					)
				: [],
		memberships: (resource) =>
			allowed()
				? knownCollections(host.memberships, host.grants, resource)
				: [],
		relationship: (resource, identity, name) =>
			allowed() ? host.relationship(resource, identity, name) : undefined,
		membership: (resource, scope, where) =>
			allowed() ? host.membership(resource, scope, where) : undefined,
		basis: (scope) =>
			scopeCurrent(scope) ? host.grants.ref(scope) : capturedRef(scope),
		access: (scope) => host.grants.state(scope),
		grant: (scope, state) => {
			if (allowed() && scopeCurrent(scope))
				host.batch(() => {
					const before = host.revision;
					host.setAccess({ decisions: [{ scope, state }] });
					remember(before);
				});
		},
		observe: (batch) => {
			if (!allowed()) return;
			host.batch(() => {
				const before = host.revision;
				if (batch.grants) {
					const decisions = batch.grants.filter((decision) => {
						if (!scopeCurrent(decision.scope)) return false;
						if (decision.requires === undefined) return true;
						const current =
							host.grants.snapshot().scopes[decision.scope]?.requires;
						const prior = ownBindings.has(decision.scope)
							? ownBindings.get(decision.scope)
							: captured.scopes[decision.scope]?.requires;
						if (equal(prior, current) || equal(current, decision.requires))
							return true;
						blockedBindings.add(decision.scope);
						return false;
					});
					host.setAccess({ decisions });
					remember(before);
					for (const decision of decisions) {
						if (decision.requires !== undefined)
							ownBindings.set(decision.scope, decision.requires);
						if (
							decision.requires !== undefined &&
							decision.state === "allowed" &&
							host.grants.state(decision.scope) === "allowed"
						)
							ownGrants.set(decision.scope, host.grants.ref(decision.scope));
					}
				}
				const identityTransitions = batch.identityTransitions?.flatMap(
					(transition) => {
						const accepted = [transition.from, transition.to].every(
							(identity) => {
								const key = host.factKey({
									resource: transition.resource,
									identity,
									field: "$presence",
								});
								return (
									current(host.cells.get(key)?.revision) &&
									current(host.invalidations.get(key))
								);
							},
						);
						return accepted
							? [{ ...transition, basis: filterBasis(transition.basis) }]
							: [];
					},
				);
				const facts = (batch.facts ?? []).flatMap((fact) => {
					if (!current(host.identityRevision(fact.resource, fact.identity)))
						return [];
					const presenceKey = host.factKey({
						resource: fact.resource,
						identity: fact.identity,
						field: "$presence",
					});
					if (
						host.cells.get(presenceKey)?.value === "absent" &&
						!current(host.cells.get(presenceKey)?.revision)
					)
						return [];
					const values = Object.fromEntries(
						Object.entries(fact.values ?? {}).filter(([field]) => {
							const key = host.factKey({
								resource: fact.resource,
								identity: fact.identity,
								field,
							});
							return (
								current(host.invalidations.get(key)) &&
								current(host.cells.get(key)?.revision)
							);
						}),
					);
					const replace = fact.replace?.filter((field) => {
						const key = host.factKey({
							resource: fact.resource,
							identity: fact.identity,
							field,
						});
						return (
							current(host.invalidations.get(key)) &&
							current(host.cells.get(key)?.revision)
						);
					});
					const presence =
						current(host.invalidations.get(presenceKey)) &&
						current(host.cells.get(presenceKey)?.revision)
							? fact.presence
							: undefined;
					const basis = filterBasis(fact.basis);
					if (basis?.every((ref) => host.grants.revoked(ref))) return [];
					const fieldBasis = Object.fromEntries(
						Object.entries(fact.fieldBasis ?? {}).map(([field, refs]) => [
							field,
							filterBasis(refs) ?? [],
						]),
					);
					for (const field of new Set([
						...Object.keys(values),
						...(replace ?? []),
						...(presence ? ["$presence"] : []),
					])) {
						const requirement = fieldAccess(
							host.definition(fact.resource),
							field,
							fact.identity,
						);
						if (!requirement) continue;
						const supplied =
							fieldBasis[field] ?? filterBasis(fact.certifiedBasis) ?? basis;
						const proof = captureProof(requirement, (scope) =>
							scopeCurrent(scope) ? host.grants.ref(scope) : capturedRef(scope),
						);
						fieldBasis[field] = [
							supplied?.length ? { all: [{ any: supplied }, proof] } : proof,
						];
					}
					return [
						{
							...fact,
							values,
							replace,
							presence,
							basis,
							fieldBasis,
							certifiedBasis: filterBasis(fact.certifiedBasis),
						},
					];
				});
				const relationships = batch.relationships?.flatMap((relationship) => {
					if (
						!current(
							host.identityRevision(
								relationship.resource,
								relationship.identity,
							),
						)
					)
						return [];
					const key = host.factKey(relationship);
					const presence = host.cells.get(
						host.factKey({
							resource: relationship.resource,
							identity: relationship.identity,
							field: "$presence",
						}),
					);
					if (
						(presence?.value === "absent" && !current(presence.revision)) ||
						!current(host.cells.get(key)?.revision) ||
						!current(host.invalidations.get(key))
					)
						return [];
					const basis = filterBasis(relationship.basis);
					const targetBasis = relationship.targetBasis?.map(
						({ target, basis: refs }) => ({
							target,
							basis: filterBasis(refs) ?? [],
						}),
					);
					if (
						basis?.every((ref) => host.grants.revoked(ref)) &&
						!targetBasis?.some((entry) =>
							entry.basis.some((ref) => !host.grants.revoked(ref)),
						)
					)
						return [];
					return [{ ...relationship, basis, targetBasis }];
				});
				const memberships = batch.memberships
					?.filter(
						(membership) =>
							current(
								host.memberships.get(membershipKey(membership))?.revision,
							) &&
							current(
								host.invalidations.get(membershipInvalidationKey(membership)),
							),
					)
					.map((membership) => {
						const definition = host.definition(membership.resource);
						const included = new Set(
							membership.identities.map((identity) =>
								host.recordKey(membership.resource, identity),
							),
						);
						const contradicted = [...host.cells.values()].some((cell) => {
							if (
								cell.resource !== membership.resource ||
								current(cell.revision)
							)
								return false;
							const record = host.records.get(
								host.recordKey(cell.resource, cell.identity),
							);
							const values = Object.fromEntries(
								Object.entries(record?.values ?? {}).filter(
									([field]) => !record?.fields[field]?.stale,
								),
							);
							if (
								membership.scope !== undefined &&
								definition.inScope?.(
									cell.identity,
									membership.scope,
									values,
								) === false
							)
								return false;
							let match: boolean | "unknown" = true;
							if (membership.where) {
								match =
									definition.matches && !isFilterExpression(membership.where)
										? definition.matches(
												values,
												membership.where,
												membership.scope,
												cell.identity,
											)
										: matchesFilter(values, membership.where);
								if (match === false) return false;
							}
							if (
								included.has(host.recordKey(cell.resource, cell.identity)) &&
								!current(host.identityRevision(cell.resource, cell.identity))
							)
								return true;
							if (cell.field === "$presence")
								return (
									(cell.value === "present") !==
									included.has(host.recordKey(cell.resource, cell.identity))
								);
							return (
								filterFields(membership.where).includes(cell.field) &&
								(match !== true ||
									!included.has(host.recordKey(cell.resource, cell.identity)))
							);
						});
						return {
							...membership,
							identities: membership.identities.filter((identity) => {
								const presence = host.cells.get(
									host.factKey({
										resource: membership.resource,
										identity,
										field: "$presence",
									}),
								);
								return (
									current(
										host.identityRevision(membership.resource, identity),
									) &&
									(presence?.value !== "absent" || current(presence.revision))
								);
							}),
							complete: membership.complete && !contradicted,
							basis: filterBasis(membership.basis),
						};
					});
				host.observe(
					{
						...batch,
						grants: undefined,
						facts,
						identityTransitions,
						relationships,
						memberships,
						invalidateMemberships: batch.invalidateMemberships?.filter(
							(ref) => {
								const membership = host.memberships.get(membershipKey(ref));
								return (
									current(membership?.revision) &&
									current(
										host.invalidations.get(membershipInvalidationKey(ref)),
									) &&
									(!membership || host.grants.allowsAny(membership.bases))
								);
							},
						),
						invalidate: batch.invalidate?.filter((ref) => {
							const key = host.factKey(ref);
							return (
								current(host.cells.get(key)?.revision) &&
								current(host.invalidations.get(key))
							);
						}),
					},
					continuity,
				);
				remember(before);
			});
		},
	};
}
