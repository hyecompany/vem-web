// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>

// SPDX-License-Identifier: Apache-2.0

import type {
	CommandDefinition,
	EditBaseline,
	PreparedEdit,
	ResourceDefinition,
	ResourceReadDefinition,
} from "@hyecompany/vem-data/runtime";

const readable: ResourceReadDefinition = {
	name: "tasks",

	access: { any: ["team", "owner"] },

	fieldAccess: { notes: { all: ["authenticated", "notes:read"] } },
};

const invalidRead: ResourceReadDefinition = {
	name: "tasks",

	// @ts-expect-error Permission arrays must declare all or any explicitly.

	access: ["team", "owner"],
};

const invalidFieldPolicy: ResourceReadDefinition = {
	name: "tasks",

	// @ts-expect-error Field policies are named declarations.

	fieldAccess: (_field: string) => "read",
};

const automatic: ResourceDefinition = {
	name: "tasks",
	sources: [],

	// @ts-expect-error Backend capabilities replace manual query acquisition.

	acquire: async () => undefined,
};

const operation: CommandDefinition = {
	access: "write",
	disclosure: "read",
	run: async () => ({ kind: "succeeded" }),

	// @ts-expect-error There is only one command admission contract.

	scopes: () => ["write"],
};

// @ts-expect-error Executing permission cannot implicitly disclose action details.
const missingDisclosure: CommandDefinition = {
	access: "write",
	run: async () => ({ kind: "succeeded" }),
};

declare const prepared: PreparedEdit<{ notes: string }>;

declare const baseline: EditBaseline;

// @ts-expect-error A declaration has no captured authority and is not a prepared editor.

const uncaptured: PreparedEdit = baseline;

// @ts-expect-error Captured editor proofs are not symbolic permission strings.

const symbolic: typeof prepared.fieldDisclosure = { notes: "read" };

void [
	readable,
	invalidRead,
	invalidFieldPolicy,
	automatic,
	operation,
	missingDisclosure,
	uncaptured,
	symbolic,
];
