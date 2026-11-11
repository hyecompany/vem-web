// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { query } from "../../src/descriptors.js";
import type { ResourceDefinition } from "../../src/types.js";

export const resource = (
	extra: Partial<ResourceDefinition> = {},
): ResourceDefinition => ({
	name: "things",
	access: () => "read",
	...extra,
});
export const options = (definition = resource()) => ({
	resources: [definition],
	contextId: "alice",
	access: [{ scope: "read", state: "allowed" as const }],
});
export const list = query({
	resource: "things",
	mode: "list",
	select: ["name", "status"],
});
export const fact = (identity: string, values: Record<string, unknown>) => ({
	resource: "things",
	identity,
	presence: "present" as const,
	values,
	basis: ["read"],
});
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
