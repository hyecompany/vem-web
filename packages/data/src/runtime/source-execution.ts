// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import { evaluateAccess } from "../read-model/access-requirements.js";
import type {
	DisclosureBasis,
	ObservationBatch,
	ObservationLiveness,
	ObservationResult,
	ResourceContext,
} from "../types.js";
import type { PlannedAcquisition } from "./planning.js";
import { inferSourceFacts } from "./source-inference.js";

export async function executeSource(
	work: PlannedAcquisition,
	context: ResourceContext,
	needed: () => boolean = () => true,
): Promise<ObservationResult> {
	const { source } = work;
	const capture = (batch: ObservationBatch) => {
		for (const fact of batch.facts ?? [])
			if (fact.resource === work.resource)
				work.seenIdentities.add(work.identityKey(fact.identity));
		for (const membership of batch.memberships ?? [])
			if (membership.resource === work.resource)
				for (const identity of membership.identities)
					work.seenIdentities.add(work.identityKey(identity));
	};
	const sourceContext: ResourceContext = {
		...context,
		get acquisitionFence() {
			return context.acquisitionFence;
		},
		observe(batch) {
			const observed = inferSourceFacts(work, request, batch);
			capture(observed);
			context.observe(observed);
		},
	};
	const pagination = source.pagination;
	const maxPages = pagination?.maxPages ?? 100;
	if (
		pagination &&
		(!Number.isInteger(pagination.pageSize) ||
			pagination.pageSize < 1 ||
			!Number.isInteger(maxPages) ||
			maxPages < 1 ||
			maxPages > 10000)
	)
		throw new Error(`Invalid pagination bounds for ${source.key}`);
	const memberships = new Map<
		string,
		{
			identities: Map<string, unknown>;
			proofs: Map<string, DisclosureBasis>;
			liveness: Map<string, ObservationLiveness>;
		}
	>();
	const cursors = new Set<string>();
	let request = work.request;
	for (let page = 0; page < maxPages; page++) {
		if (context.signal.aborted) throw new Error("Acquisition was canceled");
		const requirement =
			typeof source.access === "function"
				? source.access(request, context)
				: source.access;
		const admission = evaluateAccess(requirement, (scope) =>
			context.access(scope),
		);
		if (
			admission === "denied" ||
			(admission === "unknown" &&
				(typeof source.accessUnknown === "function"
					? source.accessUnknown(request, context)
					: source.accessUnknown) === "wait")
		)
			throw new Error("Source read access is unavailable");
		if (source.available?.(request, context) === false)
			throw new Error("The source is no longer available");
		const result = await source.run(request, sourceContext);
		if (!result || !("batch" in result)) {
			if (!result) return;
			const observed = inferSourceFacts(work, request, result);
			capture(observed);
			return observed;
		}
		if (!pagination)
			throw new Error(
				`Source ${source.key} returned a page without declaring pagination`,
			);
		const continued = result.next !== undefined;
		const batch = inferSourceFacts(work, request, result.batch);
		const observed = batch.memberships?.map((membership) => {
			const key = stableKey([
				membership.resource,
				membership.scope,
				membership.where ?? {},
			]);
			const progress = memberships.get(key) ?? {
				identities: new Map<string, unknown>(),
				proofs: new Map<string, DisclosureBasis>(),
				liveness: new Map<string, ObservationLiveness>(),
			};
			for (const identity of membership.identities)
				progress.identities.set(stableKey(identity), identity);
			const proof: DisclosureBasis = { any: membership.basis ?? [] };
			progress.proofs.set(stableKey(proof), proof);
			const liveness = membership.liveness ?? "snapshot";
			progress.liveness.set(stableKey(liveness), liveness);
			memberships.set(key, progress);
			return {
				...membership,
				identities: [...progress.identities.values()],
				basis: [{ all: [...progress.proofs.values()] }],
				liveness: { all: [...progress.liveness.values()] },
				complete: !continued && membership.complete,
			};
		});
		const observation = {
			...batch,
			facts: [
				...(batch.facts ?? []),
				...(batch.memberships ?? []).flatMap((membership) =>
					membership.identities.map((identity) => ({
						resource: membership.resource,
						identity,
						presence: "present" as const,
						basis: membership.basis,
						liveness: membership.liveness,
					})),
				),
			],
			memberships: observed,
		};
		capture(observation);
		context.observe(observation);
		if (!continued || !needed()) return;
		const cursor = stableKey(result.next);
		if (cursors.has(cursor))
			throw new Error(`Source ${source.key} repeated its continuation cursor`);
		cursors.add(cursor);
		request = {
			...request,
			page: { cursor: result.next, limit: pagination.pageSize },
		};
	}
	throw new Error(`Source ${source.key} exceeded its page limit`);
}
