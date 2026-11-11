// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import {
	evaluateAccess,
	fieldAccess,
	readAccess,
} from "../read-model/access-requirements.js";
import {
	filterCovers,
	type MissingRequirement,
} from "../read-model/requirements.js";
import type {
	AccessRequirement,
	AcquisitionRequest,
	AcquisitionSource,
	QueryDescriptor,
	QueryIssue,
	ResourceContext,
	ResourceDefinition,
} from "../types.js";
import { equal } from "../values.js";
import { broaderFilters } from "./planning-filters.js";
import type {
	AttemptedSource,
	Candidate,
	Need,
	PlannedAcquisition,
	PlanningHost,
} from "./planning-model.js";

function scopes(requirement: AccessRequirement | undefined): string[] {
	if (requirement === undefined) return [];
	if (typeof requirement === "string") return [requirement];
	return ("all" in requirement ? requirement.all : requirement.any).flatMap(
		scopes,
	);
}
function queryFor(requirement: MissingRequirement): QueryDescriptor {
	return requirement.kind === "membership" ||
		requirement.kind === "collection-field"
		? requirement.query
		: { ...requirement.query, mode: "one", identity: requirement.identity };
}
function sourceRequest(
	source: AcquisitionSource,
	requirement: MissingRequirement,
): AcquisitionRequest {
	const query =
		source.mode === "one" ? queryFor(requirement) : requirement.query;
	const supported = source.filters ?? [];
	const where =
		source.mode === "list"
			? Object.fromEntries(
					Object.entries(query.where ?? {}).filter(([field]) =>
						supported.includes(field),
					),
				)
			: undefined;
	return {
		resource: requirement.resource,
		mode: source.mode,
		...(source.mode === "one" ? { identity: requirement.identity } : {}),
		scope: source.scope ? source.scope(query) : query.scope,
		...(where && Object.keys(where).length ? { where } : {}),
		fields: source.select ? [] : [...source.fields],
		relationships: [...(source.relationships ?? [])],
		sample: query.sample,
		...(source.pagination
			? { page: { limit: source.pagination.pageSize } }
			: {}),
	};
}
function baseKey(
	source: AcquisitionSource,
	request: AcquisitionRequest,
	definition: ResourceDefinition,
	context: ResourceContext,
): string {
	const access =
		typeof source.access === "function"
			? source.access(request, context)
			: source.access;
	const query: QueryDescriptor = {
		kind: "query",
		resource: request.resource,
		mode: request.mode,
		identity: request.identity,
		scope: request.scope,
		where: request.where,
		select: request.fields,
	};
	const required = new Set([
		...scopes(readAccess(definition, query)),
		...scopes(access),
		...(request.mode === "one"
			? request.fields.flatMap((field) =>
					scopes(fieldAccess(definition, field, request.identity)),
				)
			: []),
	]);
	return stableKey([
		request.resource,
		source.key,
		request.mode,
		request.mode === "one"
			? (definition.key?.(request.identity) ?? request.identity)
			: undefined,
		request.scope,
		request.where ?? {},
		request.sample,
		request.page,
		context.accessContext,
		context.authorityFence,
		[...required].sort().map((scope) => {
			const ref = context.basis(scope);
			return { ...ref, generation: Math.max(0, ref.generation - 1) };
		}),
	]);
}
function predicateEvidence(
	candidate: Pick<PlannedAcquisition, "source" | "request">,
	requirement: MissingRequirement,
): boolean {
	const field = requirement.field;
	return (
		field !== undefined &&
		(requirement.predicate === true ||
			candidate.source.filters?.includes(field) === true) &&
		candidate.source.mode === "list" &&
		candidate.source.membership === true &&
		Object.hasOwn(candidate.request.where ?? {}, field) &&
		equal(candidate.request.where?.[field], requirement.query.where?.[field])
	);
}
function supports(
	source: AcquisitionSource,
	need: MissingRequirement,
): boolean {
	if (need.kind === "membership")
		return source.mode === "list" && source.membership === true;
	if (need.kind === "collection-field" || need.kind === "field")
		return (
			(need.kind !== "collection-field" || source.mode === "list") &&
			(source.fields.includes(need.field ?? "") ||
				predicateEvidence(
					{ source, request: sourceRequest(source, need) },
					need,
				))
		);
	if (need.kind === "relationship")
		return source.relationships?.includes(need.relationship ?? "") === true;
	return source.mode === "one" || source.membership === true;
}
export function requestCovers(
	candidate: PlannedAcquisition,
	requirement: MissingRequirement,
	definition: ResourceDefinition,
): boolean {
	if (
		candidate.resource !== requirement.resource ||
		!supports(candidate.source, requirement)
	)
		return false;
	if (
		requirement.field &&
		!candidate.source.fields.includes(requirement.field) &&
		!predicateEvidence(candidate, requirement)
	)
		return false;
	const expected = sourceRequest(candidate.source, requirement);
	if (!equal(candidate.request.scope, expected.scope)) return false;
	if (candidate.request.mode === "one") {
		const key = (identity: unknown) =>
			definition.key?.(identity) ?? stableKey(identity);
		if (key(candidate.request.identity) !== key(requirement.identity))
			return false;
	} else if (
		definition.matches && Object.keys(candidate.request.where ?? {}).length > 0
			? !equal(candidate.request.where, expected.where)
			: !filterCovers(candidate.request.where, expected.where)
	)
		return false;
	return true;
}

function targetKey(
	source: AcquisitionSource,
	request: AcquisitionRequest,
	definition: ResourceDefinition,
): string {
	return stableKey([
		request.resource,
		source.key,
		request.mode,
		request.scope,
		request.mode === "one"
			? (definition.key?.(request.identity) ?? request.identity)
			: undefined,
	]);
}
export function buildCandidates(
	host: PlanningHost,
	needs: ReadonlyMap<string, Need>,
	context: ResourceContext,
	inflight: readonly PlannedAcquisition[],
	attempted: AttemptedSource,
): {
	candidates: Map<string, Candidate>;
	blocked: { candidate: Candidate; issue: QueryIssue }[];
} {
	const candidates = new Map<string, Candidate>();
	const byTarget = new Map<string, Need[]>();
	const targetNeeds = (candidate: PlannedAcquisition): readonly Need[] =>
		byTarget.get(
			targetKey(
				candidate.source,
				candidate.request,
				host.definition(candidate.resource),
			),
		) ?? [];
	const validated = new Set<string>();
	const blocked: { candidate: Candidate; issue: QueryIssue }[] = [];
	for (const node of needs.values()) {
		const definition = host.definition(node.requirement.resource);
		if (
			evaluateAccess(
				readAccess(definition, queryFor(node.requirement)),
				context.access,
			) === "denied"
		)
			continue;
		const sources = definition.sources ?? [];
		if (
			!validated.has(definition.name) &&
			new Set(sources.map((source) => source.key)).size !== sources.length
		)
			throw new Error(`Source keys must be unique for ${definition.name}`);
		validated.add(definition.name);
		for (const source of sources) {
			if (!supports(source, node.requirement)) continue;
			const request = sourceRequest(source, node.requirement);
			const target = targetKey(source, request, definition);
			const targetRequirements = byTarget.get(target) ?? [];
			targetRequirements.push(node);
			byTarget.set(target, targetRequirements);
			const base = baseKey(source, request, definition, context);
			let candidate = candidates.get(base);
			if (!candidate) {
				if (candidates.size >= 4096) continue;
				candidate = {
					key: base,
					baseKey: base,
					resource: request.resource,
					source,
					request,
					cost: 0,
					states: [],
					covers: new Set(),
					generation: 0,
					identityKey: (identity) =>
						definition.key?.(identity) ?? stableKey(identity),
					seenIdentities: new Set(),
				};
				candidates.set(base, candidate);
			}
			if (
				node.requirement.field &&
				candidate.source.fields.includes(node.requirement.field) &&
				!candidate.request.fields.includes(node.requirement.field)
			)
				candidate.request.fields = [
					...candidate.request.fields,
					node.requirement.field,
				].sort();
			if (
				node.requirement.relationship &&
				!candidate.request.relationships.includes(node.requirement.relationship)
			)
				candidate.request.relationships = [
					...candidate.request.relationships,
					node.requirement.relationship,
				].sort();
		}
	}
	const groups = new Map<string, Candidate[]>();
	for (const candidate of candidates.values()) {
		if (candidate.request.mode !== "list" || !candidate.request.where) continue;
		const request = candidate.request;
		const key = stableKey([
			candidate.resource,
			candidate.source.key,
			request.scope,
			request.sample,
			request.page,
		]);
		const group = groups.get(key) ?? [];
		group.push(candidate);
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		const first = group[0];
		if (!first) continue;
		for (const where of broaderFilters(
			group.map((candidate) => candidate.request.where ?? {}),
		)) {
			if (candidates.size >= 4096) break;
			const request = {
				...first.request,
				where: Object.keys(where).length ? where : undefined,
				fields: [
					...new Set(group.flatMap((candidate) => candidate.request.fields)),
				].sort(),
			};
			const base = baseKey(
				first.source,
				request,
				host.definition(first.resource),
				context,
			);
			if (!candidates.has(base))
				candidates.set(base, {
					...first,
					key: base,
					baseKey: base,
					request,
					covers: new Set(),
					seenIdentities: new Set(first.seenIdentities),
				});
		}
	}
	for (const [base, candidate] of [...candidates]) {
		candidates.delete(base);
		if (candidate.source.select)
			candidate.request.fields = candidate.request.fields.filter((field) =>
				targetNeeds(candidate).some(
					(node) =>
						node.requirement.field === field &&
						requestCovers(
							candidate,
							node.requirement,
							host.definition(node.requirement.resource),
						) &&
						!inflight.some(
							(work) =>
								work.request.fields.includes(field) &&
								requestCovers(
									work,
									node.requirement,
									host.definition(node.requirement.resource),
								) &&
								baseKey(
									work.source,
									work.request,
									host.definition(work.resource),
									context,
								) === work.baseKey,
						),
				),
			);
		if (
			candidate.source.select &&
			candidate.request.fields.length === 0 &&
			candidate.request.relationships.length === 0 &&
			!candidate.source.membership
		)
			continue;
		candidate.baseKey = baseKey(
			candidate.source,
			candidate.request,
			host.definition(candidate.resource),
			context,
		);
		candidate.key = stableKey([
			candidate.baseKey,
			candidate.request.fields,
			candidate.request.relationships,
		]);
		const required =
			typeof candidate.source.access === "function"
				? candidate.source.access(candidate.request, context)
				: candidate.source.access;
		const admission = evaluateAccess(required, (scope) =>
			context.access(scope),
		);
		if (
			admission === "denied" ||
			(admission === "unknown" &&
				(typeof candidate.source.accessUnknown === "function"
					? candidate.source.accessUnknown(candidate.request, context)
					: candidate.source.accessUnknown) === "wait")
		) {
			candidate.states = [
				...new Set(
					targetNeeds(candidate)
						.filter((node) =>
							requestCovers(
								candidate,
								node.requirement,
								host.definition(node.requirement.resource),
							),
						)
						.map((node) => node.state),
				),
			];
			blocked.push({
				candidate,
				issue: {
					kind: "access",
					message:
						admission === "denied"
							? `Read access required by source ${candidate.source.key} was denied`
							: `Read authority required by source ${candidate.source.key} has not been established`,
				},
			});
			continue;
		}
		if (candidate.source.available?.(candidate.request, context) === false)
			continue;
		candidate.cost =
			typeof candidate.source.cost === "function"
				? candidate.source.cost(candidate.request)
				: (candidate.source.cost ?? 1);
		if (!(candidate.cost > 0) || !Number.isFinite(candidate.cost))
			throw new Error(
				`Source ${candidate.source.key} must declare a finite positive cost`,
			);
		candidates.set(candidate.key, candidate);
	}
	for (const work of inflight)
		candidates.set(work.key, { ...work, cost: 0, covers: new Set() });
	for (const candidate of candidates.values())
		for (const node of targetNeeds(candidate)) {
			if (
				evaluateAccess(
					readAccess(
						host.definition(node.requirement.resource),
						queryFor(node.requirement),
					),
					context.access,
				) === "denied"
			)
				continue;
			if (
				attempted(node.state, candidate, node.requirement) &&
				!inflight.some((work) => work.key === candidate.key)
			)
				continue;
			if (
				!requestCovers(
					candidate,
					node.requirement,
					host.definition(node.requirement.resource),
				)
			)
				continue;
			if (
				node.requirement.field &&
				!candidate.request.fields.includes(node.requirement.field) &&
				!predicateEvidence(candidate, node.requirement)
			)
				continue;
			if (
				node.requirement.relationship &&
				!candidate.request.relationships.includes(node.requirement.relationship)
			)
				continue;
			if (
				baseKey(
					candidate.source,
					candidate.request,
					host.definition(candidate.resource),
					context,
				) !== candidate.baseKey
			)
				continue;
			if (inflight.some((work) => work.key === candidate.key)) {
				if ((node.requirement.generation ?? 0) > candidate.generation) continue;
			} else
				candidate.generation = Math.max(
					candidate.generation,
					node.requirement.generation ?? 0,
				);
			candidate.covers.add(node.key);
			if (
				node.requirement.kind !== "membership" &&
				node.requirement.kind !== "collection-field"
			)
				candidate.seenIdentities.add(
					candidate.identityKey(node.requirement.identity),
				);
		}
	return { candidates, blocked };
}
