// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { grantKey } from "../access.js";
import { proofEvery } from "../access-proofs.js";
import { deletedFact, deletedMembership } from "../persistence-records.js";
import type { TransferReceipt, TransferRecord } from "../transfer-types.js";
import {
	captureTransferRecord,
	mergeTransferRecord,
} from "../transfers/receipt.js";
import type {
	AccessBinding,
	AccessSnapshot,
	ActionJournal,
	DisclosureProof,
	GrantRef,
	PersistedFact,
	PersistedMembership,
	PersistenceAdapter,
	PersistenceSnapshot,
} from "../types.js";
export class MemoryPersistence implements PersistenceAdapter {
	readonly access = new Map<string, AccessSnapshot>();
	readonly facts = new Map<string, PersistedFact>();
	readonly memberships = new Map<string, PersistedMembership>();
	readonly actions = new Map<string, ActionJournal>();
	readonly revoked = new Map<string, number>();
	readonly accessBindings = new Map<string, AccessBinding>();
	failure?: Error;
	private check(): void {
		if (this.failure) throw this.failure;
	}
	private allowed(
		bases: readonly DisclosureProof[],
		dependencies: readonly (readonly DisclosureProof[])[] = [],
	): boolean {
		return (
			bases.some((proof) =>
				proofEvery(
					proof,
					(basis) =>
						(this.revoked.get(grantKey(basis)) ?? -1) < basis.generation,
				),
			) && dependencies.every((proof) => this.allowed(proof))
		);
	}
	async load(): Promise<PersistenceSnapshot> {
		this.check();
		return structuredClone({
			access: [...this.access.values()],
			facts: [...this.facts.values()],
			memberships: [...this.memberships.values()],
			actions: [...this.actions.values()],
			revoked: Object.fromEntries(this.revoked),
			accessBindings: [...this.accessBindings.values()],
		});
	}
	async writeAccess(snapshot: AccessSnapshot): Promise<void> {
		this.check();
		this.access.delete(snapshot.contextId);
		this.access.set(snapshot.contextId, structuredClone(snapshot));
		while (this.access.size > 16)
			this.access.delete(this.access.keys().next().value as string);
	}
	async writeAccessBindings(bindings: readonly AccessBinding[]): Promise<void> {
		this.check();
		for (const binding of bindings)
			this.accessBindings.set(binding.key, structuredClone(binding));
	}

	async writeFacts(
		facts: readonly PersistedFact[],
		memberships: readonly PersistedMembership[],
	): Promise<void> {
		this.check();
		for (const fact of facts)
			if (
				(fact.deleted ||
					this.allowed(fact.bases, fact.disclosureDependencies)) &&
				(this.facts.get(fact.key)?.revision ?? -1) <= fact.revision
			)
				this.facts.set(
					fact.key,
					structuredClone(fact.deleted ? deletedFact(fact) : fact),
				);
		for (const membership of memberships)
			if (
				(membership.deleted || this.allowed(membership.bases)) &&
				(this.memberships.get(membership.key)?.revision ?? -1) <=
					membership.revision
			)
				this.memberships.set(
					membership.key,
					structuredClone(
						membership.deleted ? deletedMembership(membership) : membership,
					),
				);
	}
	async writeAction(action: ActionJournal): Promise<void> {
		this.check();
		const capturedTransfer =
			action.transfer && captureTransferRecord(action.transfer);
		const incoming = structuredClone({
			...action,
			...(capturedTransfer ? { transfer: capturedTransfer } : {}),
		});
		if (!this.allowed(incoming.bases)) return;
		const stored = this.actions.get(incoming.id);
		const current = stored && this.allowed(stored.bases) ? stored : undefined;
		const next =
			current && current.snapshot.revision > incoming.snapshot.revision
				? current
				: incoming;
		const transfer = mergeTransferRecord(current?.transfer, incoming.transfer);
		this.actions.set(incoming.id, {
			...next,
			...(transfer ? { transfer } : {}),
			possibleSubmission:
				current?.possibleSubmission === true || next.possibleSubmission,
		});
	}
	private permittedAction(id: string): ActionJournal | undefined {
		const row = this.actions.get(id);
		return row && this.allowed(row.bases) ? row : undefined;
	}
	async readTransfer(id: string): Promise<TransferRecord | undefined> {
		this.check();
		const row = this.permittedAction(id);
		return row?.transfer && captureTransferRecord(row.transfer);
	}
	async claimTransfer(id: string): Promise<boolean> {
		this.check();
		const row = this.permittedAction(id);
		if (!row?.transfer || row.possibleSubmission !== true) return false;
		const transfer = captureTransferRecord(row.transfer);
		if (
			transfer.state !== "prepared" ||
			transfer.receipt ||
			!transfer.admission ||
			!this.allowed([transfer.admission])
		)
			return false;
		this.actions.set(id, {
			...row,
			transfer: { ...transfer, state: "dispatching" },
		});
		return true;
	}
	async recordTransfer(
		id: string,
		update: Pick<TransferRecord, "state"> & { receipt?: TransferReceipt },
	): Promise<boolean> {
		this.check();
		const incoming = captureTransferRecord({ version: 1, ...update });
		const row = this.permittedAction(id);
		if (!row?.transfer || row.possibleSubmission !== true) return false;
		this.actions.set(id, {
			...row,
			transfer: mergeTransferRecord(row.transfer, incoming),
		});
		return true;
	}
	async revoke(scopes: readonly GrantRef[]): Promise<void> {
		this.check();
		for (const scope of scopes)
			this.revoked.set(
				grantKey(scope),
				Math.max(scope.generation, this.revoked.get(grantKey(scope)) ?? -1),
			);
		for (const [key, row] of this.facts)
			if (!row.deleted && !this.allowed(row.bases, row.disclosureDependencies))
				this.facts.delete(key);
		for (const [key, row] of this.memberships)
			if (!row.deleted && !this.allowed(row.bases))
				this.memberships.delete(key);
		for (const [key, row] of this.actions)
			if (!this.allowed(row.bases)) this.actions.delete(key);
	}
	async clear(): Promise<void> {
		this.check();
		this.access.clear();
		this.facts.clear();
		this.memberships.clear();
		this.actions.clear();
	}
	close(): void {}
}

/** Create a manually resolved promise for deterministic test and documentation scenarios. */
export function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
