// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	mapProof,
	proofEvery,
	proofLeaves,
	pruneProof,
} from "./access-proofs.js";
import { evaluateAccess } from "./read-model/access-requirements.js";
import type {
	AccessBinding,
	AccessDecision,
	AccessSnapshot,
	AccessState,
	AccessUpdate,
	DisclosureProof,
	GrantRef,
} from "./types.js";
import { equal, frozen } from "./values.js";

export const grantKey = (
	ref: Pick<GrantRef, "scope" | "contextId" | "epoch">,
): string =>
	JSON.stringify([ref.epoch ?? null, ref.contextId ?? null, ref.scope]);

export class AccessRegistry {
	private bindings = new Map<string, AccessBinding>();
	private dependencyDenied = new Set<string>();
	private retiredRestoredBindings = new Set<string>();
	private scopes = new Map<string, { state: AccessState; generation: number }>([
		["public", { state: "allowed", generation: 0 }],
	]);
	private tombstones = new Map<string, number>();
	private independent = new Set(["public"]);
	private scopeContexts = new Map<string, string>();
	private previousProofs = new Map<string, GrantRef>();
	private retiredContexts = new Map<string, number>();
	readonly epoch = globalThis.crypto.randomUUID();
	private revision = 0;
	private revocationGeneration = 0;
	private cached: AccessSnapshot | undefined;
	contextId: string;
	contextGeneration = 0;

	constructor(
		contextId = "anonymous",
		initial: readonly AccessDecision[] = [],
	) {
		this.contextId = contextId;
		this.apply({ decisions: initial });
	}

	state(scope: string): AccessState {
		if (
			!this.independent.has(scope) &&
			this.scopeContexts.get(scope) !== this.contextId
		)
			return "unknown";
		return this.scopes.get(scope)?.state ?? "unknown";
	}
	contextIndependent(scope: string): boolean {
		return this.independent.has(scope);
	}
	ref(scope: string): GrantRef {
		return {
			scope,
			generation: this.scopes.get(scope)?.generation ?? 0,
			...(scope === "public" ? {} : { epoch: this.epoch }),
			...(this.independent.has(scope) ? {} : { contextId: this.contextId }),
		};
	}
	errorGuard(scopes?: readonly string[]): () => boolean {
		const context = this.contextGeneration;
		const revocations = this.revocationGeneration;
		const proofs = scopes?.map((scope) => this.ref(scope));
		return () =>
			context === this.contextGeneration &&
			(proofs
				? proofs.every(
						(proof) =>
							this.state(proof.scope) !== "denied" && !this.revoked(proof),
					)
				: revocations === this.revocationGeneration);
	}
	proofGuard(proof: DisclosureProof): () => boolean {
		const context = this.contextGeneration;
		return () => context === this.contextGeneration && !this.revoked(proof);
	}
	register(refs: readonly DisclosureProof[]): GrantRef[] {
		const revoked: GrantRef[] = [];
		for (const ref of refs.flatMap(proofLeaves)) {
			this.previousProofs.set(`${grantKey(ref)}:${ref.generation}`, ref);
			if (
				ref.scope !== "public" &&
				((ref.contextId !== undefined &&
					this.retiredContexts.has(ref.contextId) &&
					!this.visible(ref)) ||
					(ref.epoch !== this.epoch &&
						this.retiredRestoredBindings.has(
							JSON.stringify([ref.contextId ?? null, ref.scope]),
						)) ||
					(this.state(ref.scope) === "denied" &&
						(this.independent.has(ref.scope) ||
							ref.contextId === this.contextId)))
			) {
				this.tombstones.set(
					grantKey(ref),
					Math.max(this.tombstones.get(grantKey(ref)) ?? -1, ref.generation),
				);
				revoked.push(ref);
			}
		}
		return revoked;
	}
	adopt(proof: DisclosureProof): DisclosureProof {
		return mapProof(proof, (ref) => this.adoptGrant(ref));
	}
	private established(scope: string, path = new Set<string>()): AccessState {
		const state = this.state(scope);
		if (state !== "allowed" || path.has(scope))
			return state === "denied" ? "denied" : "unknown";
		const binding = this.bindings.get(this.bindingKey(scope));
		if (!binding) return state;
		return evaluateAccess(binding.requires, (dependency) =>
			this.established(dependency, new Set([...path, scope])),
		);
	}
	private adoptGrant(ref: GrantRef): GrantRef {
		if (
			this.revoked(ref) ||
			(ref.epoch !== this.epoch && this.established(ref.scope) !== "allowed") ||
			this.state(ref.scope) !== "allowed" ||
			(!this.independent.has(ref.scope) && ref.contextId !== this.contextId)
		)
			return ref;
		return this.ref(ref.scope);
	}
	visible(proof: DisclosureProof): boolean {
		return proofEvery(proof, (ref) => this.visibleGrant(ref));
	}
	private visibleGrant(ref: GrantRef): boolean {
		const current = this.scopes.get(ref.scope);
		return (
			(ref.scope === "public" || ref.epoch === this.epoch) &&
			(this.independent.has(ref.scope) || ref.contextId === this.contextId) &&
			this.state(ref.scope) === "allowed" &&
			current?.generation === ref.generation &&
			!this.revoked(ref)
		);
	}
	revoked(proof: DisclosureProof): boolean {
		return !proofEvery(
			proof,
			(ref) =>
				(this.tombstones.get(grantKey(ref)) ?? -1) < ref.generation &&
				!(
					this.state(ref.scope) === "denied" &&
					(this.independent.has(ref.scope) || ref.contextId === this.contextId)
				),
		);
	}
	independentProof(proof: DisclosureProof): boolean {
		return proofEvery(proof, (ref) => this.contextIndependent(ref.scope));
	}
	allowsAny(refs: readonly DisclosureProof[]): boolean {
		return refs.some((ref) => this.visible(ref));
	}
	surviving(refs: readonly DisclosureProof[]): DisclosureProof[] {
		return refs.flatMap((ref) => {
			const surviving = pruneProof(ref, (grant) => !this.revoked(grant));
			return surviving ? [surviving] : [];
		});
	}

	apply(update: AccessUpdate): GrantRef[] {
		const revoked: GrantRef[] = [];
		if (update.contextId !== undefined && update.contextId !== this.contextId) {
			if (update.retirePrevious !== false) {
				this.retiredContexts.set(this.contextId, this.contextGeneration);
			}
			for (const [scope, entry] of this.scopes) {
				if (
					this.independent.has(scope) ||
					this.scopeContexts.get(scope) !== this.contextId
				)
					continue;
				if (update.retirePrevious !== false)
					revoked.push(...this.change(scope, "denied"));
				else if (entry.state === "allowed") this.change(scope, "unknown");
			}
			this.contextId = update.contextId;
			if (this.retiredContexts.has(this.contextId))
				for (const [scope, owner] of this.scopeContexts)
					if (
						owner === this.contextId &&
						this.scopes.get(scope)?.state === "denied"
					)
						this.change(scope, "unknown");
			this.contextGeneration++;
			this.revision++;
			this.cached = undefined;
		}
		for (const decision of update.decisions) {
			if (decision.contextIndependent === true)
				this.independent.add(decision.scope);
			if (decision.contextIndependent === false)
				this.independent.delete(decision.scope);
			const key = this.bindingKey(decision.scope);
			if (decision.state !== undefined) this.dependencyDenied.delete(key);
			if (decision.requires !== undefined) {
				if (decision.scope === "public")
					throw new Error(
						"Static public permission cannot depend on protected authority",
					);
				const previous = this.bindings.get(key);
				if (!previous || !equal(previous.requires, decision.requires)) {
					if (previous) {
						revoked.push(...this.change(decision.scope, "denied"));
						if (decision.state === undefined)
							this.change(decision.scope, "unknown");
					}
					this.bindings.set(
						key,
						frozen({
							key,
							scope: decision.scope,
							requires: structuredClone(decision.requires),
							...(this.independent.has(decision.scope)
								? {}
								: { contextId: this.contextId }),
						}),
					);
					this.revision++;
					this.cached = undefined;
				}
			}
			if (
				decision.state === undefined &&
				this.state(decision.scope) === "unknown"
			)
				this.change(decision.scope, "unknown");
			if (decision.state !== undefined)
				revoked.push(...this.change(decision.scope, decision.state));
		}
		revoked.push(...this.cascade());
		return revoked;
	}

	private bindingKey(scope: string): string {
		return JSON.stringify([
			this.independent.has(scope) ? null : this.contextId,
			scope,
		]);
	}
	knownRefs(scope: string, contextId?: string): GrantRef[] {
		return [
			{ ...this.ref(scope), ...(contextId === undefined ? {} : { contextId }) },
			...[...this.previousProofs.values()].filter(
				(ref) => ref.scope === scope && ref.contextId === contextId,
			),
		];
	}
	bindingsSnapshot(): readonly AccessBinding[] {
		return [...this.bindings.values()];
	}
	restoreBindings(bindings: readonly AccessBinding[]): void {
		for (const binding of bindings) {
			const existing = this.bindings.get(binding.key);
			if (existing) {
				if (!equal(existing.requires, binding.requires))
					this.retiredRestoredBindings.add(binding.key);
				continue;
			}
			this.bindings.set(binding.key, frozen(structuredClone(binding)));
			if (
				(binding.contextId === undefined ||
					binding.contextId === this.contextId) &&
				this.state(binding.scope) === "unknown"
			)
				this.change(binding.scope, "unknown");
			this.revision++;
			this.cached = undefined;
		}
	}

	private cascade(): GrantRef[] {
		const revoked: GrantRef[] = [];
		const bindings = [...this.bindings].filter(
			([, binding]) =>
				binding.contextId === undefined || binding.contextId === this.contextId,
		);
		const denied = new Set<string>();
		let changed: boolean;
		do {
			changed = false;
			for (const [key, binding] of bindings) {
				if (denied.has(key)) continue;
				const decision = evaluateAccess(binding.requires, (scope) => {
					const target = this.bindingKey(scope);
					if (denied.has(target)) return "denied";
					return this.dependencyDenied.has(target)
						? "unknown"
						: this.state(scope);
				});
				if (decision === "denied") {
					denied.add(key);
					changed = true;
				}
			}
		} while (changed);
		for (const [key, binding] of bindings) {
			if (denied.has(key) && this.state(binding.scope) !== "denied") {
				revoked.push(...this.change(binding.scope, "denied"));
				this.dependencyDenied.add(key);
			} else if (!denied.has(key) && this.dependencyDenied.delete(key)) {
				this.change(binding.scope, "unknown");
			}
		}
		return revoked;
	}

	private change(scope: string, state: AccessState): GrantRef[] {
		if (scope === "public" && state !== "allowed")
			throw new Error(
				"The static public scope cannot be revoked; use a resource-specific disclosure scope",
			);
		const previous = this.scopes.get(scope);
		const changedContext =
			!this.independent.has(scope) &&
			this.scopeContexts.get(scope) !== this.contextId;
		if (previous?.state === state && !changedContext) return [];
		let generation = previous?.generation ?? 0;
		const revoked: GrantRef[] = [];
		if (state === "denied") {
			this.revocationGeneration++;
			const old = this.ref(scope);
			this.tombstones.set(
				grantKey(old),
				Math.max(this.tombstones.get(grantKey(old)) ?? -1, generation + 1),
			);
			revoked.push({ ...old, generation: generation + 1 });
			for (const proof of this.previousProofs.values())
				if (
					proof.scope === scope &&
					(this.independent.has(scope) || proof.contextId === this.contextId)
				) {
					this.tombstones.set(
						grantKey(proof),
						Math.max(
							this.tombstones.get(grantKey(proof)) ?? -1,
							proof.generation,
						),
					);
					revoked.push(proof);
				}
			generation++;
		} else if (!previous || previous.state === "denied" || changedContext)
			generation++;
		this.scopes.set(scope, { state, generation });
		if (!this.independent.has(scope))
			this.scopeContexts.set(scope, this.contextId);
		this.revision++;
		this.cached = undefined;
		return revoked;
	}

	restoreTombstones(values: Readonly<Record<string, number>>): void {
		for (const [key, generation] of Object.entries(values)) {
			if (generation > (this.tombstones.get(key) ?? -1))
				this.revocationGeneration++;
			this.tombstones.set(
				key,
				Math.max(generation, this.tombstones.get(key) ?? -1),
			);
			const [epoch, contextId, scope] = JSON.parse(key) as [
				string | null,
				string | null,
				string,
			];
			if (
				scope === "public" ||
				epoch !== this.epoch ||
				(contextId !== null && contextId !== this.contextId)
			)
				continue;
			const current = this.scopes.get(scope);
			if (
				current &&
				current.state !== "denied" &&
				current.generation <= generation
			)
				this.scopes.set(scope, { ...current, generation: generation + 1 });
		}
		this.revision++;
		this.cached = undefined;
	}

	snapshot(): AccessSnapshot {
		this.cached ??= Object.freeze({
			contextId: this.contextId,
			epoch: this.epoch,
			revision: this.revision,
			retiredContexts: Object.freeze(Object.fromEntries(this.retiredContexts)),
			scopes: Object.freeze(
				Object.fromEntries(
					[...this.scopes]
						.filter(
							([key]) =>
								this.independent.has(key) ||
								this.scopeContexts.get(key) === this.contextId,
						)
						.map(([key, value]) => [
							key,
							Object.freeze({
								...value,
								contextIndependent: this.independent.has(key),
								requires: this.bindings.get(this.bindingKey(key))?.requires,
							}),
						]),
				),
			),
		});
		return this.cached;
	}
	close(): void {
		this.scopes = new Map([["public", { state: "allowed", generation: 0 }]]);
		this.retiredRestoredBindings.clear();
		this.bindings.clear();
		this.dependencyDenied.clear();
		this.scopeContexts.clear();
		this.previousProofs.clear();
		this.retiredContexts.clear();
		this.tombstones.clear();
		this.independent = new Set(["public"]);
		this.contextId = "closed";
		this.contextGeneration++;
		this.revision++;
		this.cached = undefined;
	}
}
