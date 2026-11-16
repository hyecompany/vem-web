// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import type { GrantRef, PersistenceAdapter } from "../types.js";

/** A failed authority write cannot be followed by payload writes that would restore without its constraints. */
export function authorityPersistence(
	storage: PersistenceAdapter,
	grants: AccessRegistry,
	ready: () => Promise<void>,
): PersistenceAdapter {
	let barrier = Promise.resolve();
	const loadPages = storage.loadPages?.bind(storage);
	const claimTransfer = storage.claimTransfer?.bind(storage);
	const recordTransfer = storage.recordTransfer?.bind(storage);
	const authority = (work: () => Promise<void>, refs: readonly GrantRef[]) => {
		barrier = barrier.then(work).catch(async (error: unknown) => {
			try {
				await storage.revoke(refs);
			} catch {
				/* Preserve the original persistence failure. */
			}
			throw error;
		});
		void barrier.catch(() => undefined);
		return barrier;
	};
	const payload = async <T>(work: () => Promise<T>): Promise<T> => {
		await ready();
		await barrier;
		return work();
	};
	return {
		load: () => storage.load(),
		...(loadPages ? { loadPages } : {}),
		writeAccess: (snapshot) =>
			authority(
				() => storage.writeAccess(snapshot),
				Object.keys(snapshot.scopes)
					.filter((scope) => scope !== "public")
					.flatMap((scope) =>
						grants.knownRefs(
							scope,
							snapshot.scopes[scope]?.contextIndependent
								? undefined
								: snapshot.contextId,
						),
					),
			),
		writeAccessBindings: (bindings) =>
			authority(
				() => storage.writeAccessBindings(bindings),
				bindings.flatMap((binding) =>
					grants.knownRefs(binding.scope, binding.contextId),
				),
			),
		writeFacts: (facts, memberships) =>
			payload(() => storage.writeFacts(facts, memberships)),
		writeAction: (action) => payload(() => storage.writeAction(action)),
		...(storage.readTransfer
			? { readTransfer: storage.readTransfer.bind(storage) }
			: {}),
		...(claimTransfer
			? {
					claimTransfer: (id: string) => payload(() => claimTransfer(id)),
				}
			: {}),
		...(recordTransfer
			? {
					recordTransfer: (
						...args: Parameters<
							NonNullable<PersistenceAdapter["recordTransfer"]>
						>
					) => payload(() => recordTransfer(...args)),
				}
			: {}),
		revoke: (refs) => storage.revoke(refs),
		clear: () => storage.clear(),
		close: () => storage.close(),
	};
}
