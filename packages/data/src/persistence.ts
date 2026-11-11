// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { Dexie, type Table } from "dexie";
import { grantKey } from "./access.js";
import { proofEvery } from "./access-proofs.js";
import { deletedFact, deletedMembership } from "./persistence-records.js";
import type { TransferReceipt, TransferRecord } from "./transfer-types.js";
import {
	captureTransferRecord,
	mergeTransferRecord,
} from "./transfers/receipt.js";
import type {
	AccessBinding,
	ActionJournal,
	DisclosureProof,
	GrantRef,
	PersistedFact,
	PersistedMembership,
	PersistenceAdapter,
	PersistenceSnapshot,
} from "./types.js";

interface Tombstone {
	scope: string;
	generation: number;
}
export const persistenceSchemaVersion = 1;
const permitted = (
	bases: readonly DisclosureProof[],
	revoked: ReadonlyMap<string, number>,
	dependencies: readonly (readonly DisclosureProof[])[] = [],
) =>
	bases.some((proof) =>
		proofEvery(
			proof,
			(basis) => (revoked.get(grantKey(basis)) ?? -1) < basis.generation,
		),
	) &&
	dependencies.every((proof) =>
		proof.some((proof) =>
			proofEvery(
				proof,
				(basis) => (revoked.get(grantKey(basis)) ?? -1) < basis.generation,
			),
		),
	);

export class DexiePersistence implements PersistenceAdapter {
	private db: Dexie;
	private facts: Table<PersistedFact, string>;
	private relationships: Table<PersistedFact, string>;
	private memberships: Table<PersistedMembership, string>;
	private actions: Table<ActionJournal & { terminal?: number }, string>;
	private tombstones: Table<Tombstone, string>;
	private accessBindings: Table<AccessBinding, string>;
	private queue: Promise<unknown> = Promise.resolve();
	private closed = false;

	constructor(
		name: string,
		options?: ConstructorParameters<typeof Dexie>[1],
		private retention: {
			maxFacts?: number;
			maxMemberships?: number;
			maxSettledActions?: number;
		} = {},
	) {
		this.db = new Dexie(name, options);
		this.db.version(persistenceSchemaVersion).stores({
			facts: "key,resource,revision",
			relationships: "key,resource,revision",
			memberships: "key,resource,revision",
			actions: "id,terminal,snapshot.revision",
			tombstones: "scope",
			accessBindings: "key",
		});
		this.facts = this.db.table("facts");
		this.relationships = this.db.table("relationships");
		this.memberships = this.db.table("memberships");
		this.actions = this.db.table("actions");
		this.tombstones = this.db.table("tombstones");
		this.accessBindings = this.db.table("accessBindings");
		this.db.on("versionchange", () => this.close());
		this.db.on("ready", () => {
			if (this.db.backendDB().version !== persistenceSchemaVersion * 10)
				throw new Error(
					"This persistence format requires a newer Vem Data runtime",
				);
		});
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(() => {
			if (this.closed) throw new Error("Persistence is closed");
			return work();
		});
		this.queue = result.catch(() => undefined);
		return result;
	}

	load(): Promise<PersistenceSnapshot> {
		return this.enqueue(() =>
			this.db.transaction(
				"r",
				[
					this.facts,
					this.relationships,
					this.memberships,
					this.actions,
					this.tombstones,
					this.accessBindings,
				],
				async () => {
					const tombstones = await this.tombstones.toArray();
					const revoked = new Map(
						tombstones.map((row) => [row.scope, row.generation]),
					);
					const [facts, relationships, memberships, actions, accessBindings] =
						await Promise.all([
							this.facts.toArray(),
							this.relationships.toArray(),
							this.memberships.toArray(),
							this.actions.toArray(),
							this.accessBindings.toArray(),
						]);
					return {
						facts: [...facts, ...relationships].filter(
							(row) =>
								row.deleted === true ||
								permitted(row.bases, revoked, row.disclosureDependencies),
						),
						memberships: memberships.filter(
							(row) => row.deleted === true || permitted(row.bases, revoked),
						),
						actions: actions.filter((row) => permitted(row.bases, revoked)),
						revoked: Object.fromEntries(revoked),
						accessBindings,
					};
				},
			),
		);
	}

	async *loadPages(pageSize: number): AsyncIterable<PersistenceSnapshot> {
		if (!Number.isInteger(pageSize) || pageSize < 1)
			throw new Error("Hydration page size must be positive");
		yield await this.enqueue(() =>
			this.db.transaction(
				"r",
				[this.accessBindings, this.tombstones],
				async () => ({
					facts: [],
					memberships: [],
					actions: [],
					accessBindings: await this.accessBindings.toArray(),
					revoked: Object.fromEntries(
						(await this.tombstones.toArray()).map((row) => [
							row.scope,
							row.generation,
						]),
					),
				}),
			),
		);
		for (const kind of [
			"facts",
			"relationships",
			"memberships",
			"actions",
		] as const) {
			let cursor: string | undefined;
			while (!this.closed) {
				const page = await this.enqueue(() =>
					this.db.transaction("r", [this[kind], this.tombstones], async () => {
						const revoked = new Map(
							(await this.tombstones.toArray()).map((row) => [
								row.scope,
								row.generation,
							]),
						);
						const table = this[kind] as Table<
							PersistedFact | PersistedMembership | ActionJournal,
							string
						>;
						const rows = await (cursor === undefined
							? table.orderBy(":id")
							: table.where(":id").above(cursor)
						)
							.limit(pageSize)
							.toArray();
						return {
							rows,
							revoked: Object.fromEntries(revoked),
							admitted: rows.filter(
								(row) =>
									("deleted" in row && row.deleted === true) ||
									permitted(
										row.bases,
										revoked,
										"field" in row ? row.disclosureDependencies : undefined,
									),
							),
						};
					}),
				);
				if (page.rows.length === 0) {
					if (cursor === undefined)
						yield {
							facts: [],
							memberships: [],
							actions: [],
							revoked: page.revoked,
						};
					break;
				}
				const last = page.rows.at(-1);
				if (!last) break;
				cursor = "key" in last ? last.key : last.id;
				yield {
					facts:
						kind === "facts" || kind === "relationships"
							? (page.admitted as PersistedFact[])
							: [],
					memberships:
						kind === "memberships"
							? (page.admitted as PersistedMembership[])
							: [],
					actions: kind === "actions" ? (page.admitted as ActionJournal[]) : [],
					revoked: page.revoked,
				};
				if (page.rows.length < pageSize) break;
			}
		}
	}

	writeAccessBindings(bindings: readonly AccessBinding[]): Promise<void> {
		return this.enqueue(async () => {
			await this.accessBindings.bulkPut(structuredClone([...bindings]));
		});
	}

	writeFacts(
		facts: readonly PersistedFact[],
		memberships: readonly PersistedMembership[],
	): Promise<void> {
		return this.enqueue(() =>
			this.db.transaction(
				"rw",
				[this.facts, this.relationships, this.memberships, this.tombstones],
				async () => {
					const revoked = new Map(
						(await this.tombstones.toArray()).map((row) => [
							row.scope,
							row.generation,
						]),
					);
					for (const row of facts) {
						if (
							!row.deleted &&
							!permitted(row.bases, revoked, row.disclosureDependencies)
						)
							continue;
						const table =
							row.kind === "relationship" ? this.relationships : this.facts;
						const current = await table.get(row.key);
						if (!current || current.revision <= row.revision)
							await table.put(
								structuredClone(row.deleted ? deletedFact(row) : row),
							);
					}
					for (const row of memberships) {
						if (!row.deleted && !permitted(row.bases, revoked)) continue;
						const current = await this.memberships.get(row.key);
						if (!current || current.revision <= row.revision)
							await this.memberships.put(
								structuredClone(row.deleted ? deletedMembership(row) : row),
							);
					}
					const excessFacts =
						(await this.facts.count()) +
						(await this.relationships.count()) -
						(this.retention.maxFacts ?? 100000);
					if (excessFacts > 0) {
						const oldest = (
							await Promise.all(
								[this.facts, this.relationships].map((table) =>
									table.orderBy("revision").limit(excessFacts).toArray(),
								),
							)
						)
							.flat()
							.sort((a, b) => a.revision - b.revision)
							.slice(0, excessFacts);
						await this.facts.bulkDelete(
							oldest
								.filter((row) => row.kind !== "relationship")
								.map((row) => row.key),
						);
						await this.relationships.bulkDelete(
							oldest
								.filter((row) => row.kind === "relationship")
								.map((row) => row.key),
						);
					}
					const excessMemberships =
						(await this.memberships.count()) -
						(this.retention.maxMemberships ?? 1000);
					if (excessMemberships > 0)
						await this.memberships.bulkDelete(
							await this.memberships
								.orderBy("revision")
								.limit(excessMemberships)
								.primaryKeys(),
						);
				},
			),
		);
	}

	async writeAction(action: ActionJournal): Promise<void> {
		const capturedTransfer =
			action.transfer && captureTransferRecord(action.transfer);
		const incoming = structuredClone({
			...action,
			...(capturedTransfer ? { transfer: capturedTransfer } : {}),
		});
		return this.enqueue(() =>
			this.db.transaction("rw", [this.actions, this.tombstones], async () => {
				const revoked = new Map(
					(await this.tombstones.toArray()).map((row) => [
						row.scope,
						row.generation,
					]),
				);
				if (!permitted(incoming.bases, revoked)) return;
				const stored = await this.actions.get(incoming.id);
				const current =
					stored && permitted(stored.bases, revoked) ? stored : undefined;
				const next =
					current && current.snapshot.revision > incoming.snapshot.revision
						? current
						: incoming;
				const transfer = mergeTransferRecord(
					current?.transfer,
					incoming.transfer,
				);
				await this.actions.put({
					...next,
					...(transfer ? { transfer } : {}),
					possibleSubmission:
						current?.possibleSubmission === true || next.possibleSubmission,
					terminal:
						next.snapshot.phase === "settled" &&
						next.snapshot.outcome?.kind !== "unknown"
							? 1
							: 0,
				});
				const terminal = await this.actions
					.where("terminal")
					.equals(1)
					.sortBy("snapshot.revision");
				const excess =
					terminal.length - (this.retention.maxSettledActions ?? 200);
				if (excess > 0)
					await this.actions.bulkDelete(
						terminal.slice(0, excess).map((row) => row.id),
					);
			}),
		);
	}

	private async permittedAction(
		id: string,
		checkAdmission = false,
	): Promise<(ActionJournal & { terminal?: number }) | undefined> {
		const revoked = new Map(
			(await this.tombstones.toArray()).map((row) => [
				row.scope,
				row.generation,
			]),
		);
		const row = await this.actions.get(id);
		return row &&
			permitted(row.bases, revoked) &&
			(!checkAdmission ||
				(row.transfer?.admission &&
					permitted([row.transfer.admission], revoked)))
			? row
			: undefined;
	}

	readTransfer(id: string): Promise<TransferRecord | undefined> {
		return this.enqueue(() =>
			this.db.transaction("r", [this.actions, this.tombstones], async () => {
				const row = await this.permittedAction(id);
				return row?.transfer && captureTransferRecord(row.transfer);
			}),
		);
	}

	claimTransfer(id: string): Promise<boolean> {
		return this.enqueue(() =>
			this.db.transaction("rw", [this.actions, this.tombstones], async () => {
				const row = await this.permittedAction(id, true);
				if (!row?.transfer || row.possibleSubmission !== true) return false;
				const transfer = captureTransferRecord(row.transfer);
				if (transfer.state !== "prepared" || transfer.receipt) return false;
				await this.actions.put({
					...row,
					transfer: { ...transfer, state: "dispatching" },
				});
				return true;
			}),
		);
	}

	async recordTransfer(
		id: string,
		update: Pick<TransferRecord, "state"> & { receipt?: TransferReceipt },
	): Promise<boolean> {
		const incoming = captureTransferRecord({ version: 1, ...update });
		return this.enqueue(() =>
			this.db.transaction("rw", [this.actions, this.tombstones], async () => {
				const row = await this.permittedAction(id);
				if (!row?.transfer || row.possibleSubmission !== true) return false;
				await this.actions.put({
					...row,
					transfer: mergeTransferRecord(row.transfer, incoming),
				});
				return true;
			}),
		);
	}

	revoke(refs: readonly GrantRef[]): Promise<void> {
		return this.enqueue(async () => {
			await this.db.transaction("rw", this.tombstones, async () => {
				for (const ref of refs) {
					const scope = grantKey(ref);
					const old = await this.tombstones.get(scope);
					if (!old || old.generation < ref.generation)
						await this.tombstones.put({ scope, generation: ref.generation });
				}
			});
			await this.db.transaction(
				"rw",
				[
					this.facts,
					this.relationships,
					this.memberships,
					this.actions,
					this.tombstones,
				],
				async () => {
					const revoked = new Map(
						(await this.tombstones.toArray()).map((row) => [
							row.scope,
							row.generation,
						]),
					);
					await this.facts
						.filter(
							(row) =>
								!row.deleted &&
								!permitted(row.bases, revoked, row.disclosureDependencies),
						)
						.delete();
					await this.relationships
						.filter(
							(row) =>
								!row.deleted &&
								!permitted(row.bases, revoked, row.disclosureDependencies),
						)
						.delete();
					await this.memberships
						.filter((row) => !row.deleted && !permitted(row.bases, revoked))
						.delete();
					await this.actions
						.filter((row) => !permitted(row.bases, revoked))
						.delete();
				},
			);
		});
	}

	clear(): Promise<void> {
		return this.enqueue(() =>
			this.db.transaction(
				"rw",
				[this.facts, this.relationships, this.memberships, this.actions],
				async () => {
					await Promise.all([
						this.facts.clear(),
						this.relationships.clear(),
						this.memberships.clear(),
						this.actions.clear(),
					]);
				},
			),
		);
	}
	close(): void {
		this.closed = true;
		this.db.close();
	}
}
