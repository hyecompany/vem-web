// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { QueryDescriptor, Values } from "../types.js";

export interface MissingRequirement {
	kind:
		| "membership"
		| "presence"
		| "field"
		| "collection-field"
		| "relationship";
	resource: string;
	identity?: unknown;
	scope?: unknown;
	where?: Readonly<Values>;
	field?: string;
	/** A filter decision may be established by scoped membership without disclosing the field value. */
	predicate?: boolean;
	relationship?: string;
	query: QueryDescriptor;
	/** Changes only when this missing evidence is explicitly withdrawn or its coverage is lost. */
	generation?: number;
	/** Existing permitted evidence for this requirement is known to be stale. */
	stale?: boolean;
}

export function requirementKey(requirement: MissingRequirement): string {
	const { query: _query, stale: _stale, ...identity } = requirement;
	return stableKey(identity);
}

export { filterCovers } from "../filters.js";
