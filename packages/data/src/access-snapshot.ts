// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessSnapshot, GrantRef } from "./types.js";

export function snapshotGrant(
	snapshot: AccessSnapshot,
	scope: string,
): GrantRef {
	const value = snapshot.scopes[scope];
	if (!value) throw new Error(`Missing permission snapshot for ${scope}`);
	return {
		scope,
		generation: value.generation,
		...(scope === "public" ? {} : { epoch: snapshot.epoch }),
		...(value.contextIndependent ? {} : { contextId: snapshot.contextId }),
	};
}
