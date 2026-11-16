// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import type {
	DisclosureProof,
	EvidenceRef,
	IdentityTransition,
	IdentityTransitionObservation,
	PersistedFact,
} from "../types.js";
import { frozen } from "../values.js";
import type { ContinuitySnapshot } from "./continuity.js";
import type { KnowledgeStore } from "./knowledge.js";

interface Incarnation {
	token: string;
	revision: number;
	presence: unknown;
	stale: boolean;
}
interface TransitionEvidence {
	transition: IdentityTransition;
	bases: readonly DisclosureProof[];
}

/** Session-local identity evidence; eviction or an event gap must never invent an alias. */
export class IdentityTransitions {
	private readonly incarnations = new Map<string, Incarnation>();
	private readonly evidence = new Map<string, TransitionEvidence>();
	constructor(private readonly grants: AccessRegistry) {}
	presence(
		key: string,
		value: unknown,
		stale: boolean,
		revision: number,
	): void {
		const previous = this.incarnations.get(key);
		const renewed =
			!previous ||
			(previous.presence === "absent" && value === "present") ||
			(!previous.stale && stale);
		this.incarnations.set(key, {
			token: renewed ? crypto.randomUUID() : previous.token,
			revision: previous ? (renewed ? revision : previous.revision) : -1,
			presence: value,
			stale,
		});
	}
	reference(key: string): string | undefined {
		return this.incarnations.get(key)?.token;
	}
	revision(key: string): number | undefined {
		return this.incarnations.get(key)?.revision;
	}
	forget(key: string): void {
		this.incarnations.delete(key);
	}
	add(transition: IdentityTransition, bases: readonly DisclosureProof[]): void {
		this.evidence.set(transition.from.incarnation, {
			transition: frozen(structuredClone(transition)),
			bases,
		});
		while (this.evidence.size > 512)
			this.evidence.delete(this.evidence.keys().next().value as string);
	}
	snapshot(): readonly IdentityTransition[] {
		const result: IdentityTransition[] = [];
		for (const [key, value] of this.evidence) {
			const bases = this.grants.surviving(value.bases);
			if (!bases.length) this.evidence.delete(key);
			else {
				value.bases = bases.map((basis) => this.grants.adopt(basis));
				if (this.grants.allowsAny(value.bases)) result.push(value.transition);
			}
		}
		return result;
	}
	clear(): void {
		this.incarnations.clear();
		this.evidence.clear();
	}
}

export function ingestIdentityTransition(
	knowledge: KnowledgeStore,
	grants: AccessRegistry,
	transition: IdentityTransitionObservation,
	changed: EvidenceRef[],
	persisted: PersistedFact[],
	continuity: ContinuitySnapshot,
): void {
	const { resource, from, to, basis, liveness } = transition;
	const fromKey = knowledge.recordKey(resource, from);
	const toKey = knowledge.recordKey(resource, to);
	const bases = knowledge.basis(basis);
	if (fromKey === toKey || !grants.allowsAny(bases)) return;
	const previous = knowledge.cells.get(
		knowledge.factKey({
			resource,
			identity: from,
			field: "$presence",
		}),
	);
	if (previous?.value === "absent") return;
	knowledge.ingest(
		{ resource, identity: from, presence: "absent", basis, liveness },
		changed,
		persisted,
		undefined,
		continuity,
	);
	const origin = knowledge.identities.reference(fromKey);
	const target = knowledge.cells.get(
		knowledge.factKey({
			resource,
			identity: to,
			field: "$presence",
		}),
	);
	if (target?.value === "present")
		knowledge.ingest(
			{ resource, identity: to, presence: "absent", basis, liveness },
			changed,
			persisted,
			undefined,
			continuity,
		);
	knowledge.ingest(
		{ resource, identity: to, presence: "present", basis, liveness },
		changed,
		persisted,
		undefined,
		continuity,
	);
	const destination = knowledge.identities.reference(toKey);
	if (origin && destination)
		knowledge.identities.add(
			{
				resource,
				from: { identity: from, incarnation: origin },
				to: { identity: to, incarnation: destination },
			},
			bases,
		);
}
