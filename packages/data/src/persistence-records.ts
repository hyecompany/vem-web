// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { PersistedFact, PersistedMembership } from "./types.js";

/** Keep only ordering metadata when a retired value is removed from durable knowledge. */
export function deletedFact(
	row: Pick<PersistedFact, "key" | "resource" | "field" | "revision" | "kind">,
): PersistedFact {
	return {
		key: row.key,
		resource: row.resource,
		field: row.field,
		kind: row.kind,
		revision: row.revision,
		deleted: true,
		identity: undefined,
		value: undefined,
		bases: [],
		dependencies: [],
		supports: [],
		liveness: "snapshot",
		source: "observed",
	};
}

export function deletedMembership(
	row: Pick<PersistedMembership, "key" | "resource" | "revision">,
): PersistedMembership {
	return {
		key: row.key,
		resource: row.resource,
		revision: row.revision,
		deleted: true,
		identities: [],
		complete: false,
		observedComplete: false,
		bases: [],
		supports: [],
	};
}
