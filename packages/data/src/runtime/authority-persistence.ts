// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import type { PersistenceAdapter } from "../types.js";

/** A failed authority write cannot be followed by payload writes that would restore without its constraints. */
export function authorityPersistence(
	storage: PersistenceAdapter,
	grants: AccessRegistry,
): PersistenceAdapter {
	let barrier = Promise.resolve();
	const loadPages = storage.loadPages?.bind(storage);
	const claimTransfer = storage.claimTransfer?.bind(storage);
	const recordTransfer = storage.recordTransfer?.bind(storage);
	return {
		load: () => storage.load(),
		...(loadPages ? { loadPages } : {}),
		writeAccessBindings(bindings) {
			const refs = bindings.flatMap((binding) =>
				grants.knownRefs(binding.scope, binding.contextId),
			);
			barrier = barrier
				.then(async () => {
					await storage.writeAccessBindings(bindings);
				})
				.catch(async (error: unknown) => {
					try {
						await storage.revoke(refs);
					} catch {
						/* The original failure remains observable. */
					}
					throw error;
				});
			void barrier.catch(() => undefined);
			return barrier;
		},
		writeFacts: (facts, memberships) =>
			barrier.then(() => storage.writeFacts(facts, memberships)),
		writeAction: (action) => barrier.then(() => storage.writeAction(action)),
		...(storage.readTransfer
			? { readTransfer: storage.readTransfer.bind(storage) }
			: {}),
		...(claimTransfer
			? {
					claimTransfer: (id: string) => barrier.then(() => claimTransfer(id)),
				}
			: {}),
		...(recordTransfer
			? {
					recordTransfer: (
						...args: Parameters<
							NonNullable<PersistenceAdapter["recordTransfer"]>
						>
					) => barrier.then(() => recordTransfer(...args)),
				}
			: {}),
		revoke: (refs) => storage.revoke(refs),
		clear: () => storage.clear(),
		close: () => storage.close(),
	};
}
