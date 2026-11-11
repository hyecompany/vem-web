// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { CommandDefinition } from "../../src/runtime.js";

const transfer: CommandDefinition = {
	disclosure: "public",
	transfer: {
		prepare: () => ({
			url: "https://example.test/upload",
			method: "POST",
			body: new Blob(),
		}),
		complete: () => ({ kind: "succeeded" }),
	},
};
// @ts-expect-error A native transfer cannot provide a second custom execution path.
const duplicate: CommandDefinition = {
	...transfer,
	run: async () => ({ kind: "succeeded" }),
};
// @ts-expect-error Recovery belongs to the native transfer executor.
const customRecovery: CommandDefinition = {
	...transfer,
	recover: async () => ({ kind: "succeeded" }),
};
void [transfer, duplicate, customRecovery];

// @ts-expect-error Transfers cannot bypass mutation admission as local controls.
const control: CommandDefinition = { ...transfer, execution: "control" };
void control;
