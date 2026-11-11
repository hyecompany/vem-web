// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { command } from "../../src/descriptors.js";
import type {
	TransferDefinition,
	TransferExecutor,
	TransferReceipt,
} from "../../src/transfer-types.js";
import type { AccessRequirement, DisclosureBasis } from "../../src/types.js";
import { resource } from "./scenario.js";

export const upload = command({
	resource: "things",
	name: "upload",
	target: "a",
	input: { file: new Blob(["contents"]) },
});
export const response: TransferReceipt = {
	kind: "response",
	status: 200,
	headers: {},
	body: '{"saved":true}',
};
export function transferResource(
	overrides: Partial<TransferDefinition> = {},
	permissions: {
		access?: AccessRequirement;
		disclosure?: DisclosureBasis;
	} = {},
) {
	return resource({
		commands: {
			upload: {
				access: "read",
				disclosure: "read",
				...permissions,
				transfer: {
					prepare: (command) => ({
						url: "https://service.test/upload",
						method: "POST",
						body: (command.input as { file: Blob }).file,
					}),
					complete: (receipt) =>
						receipt.kind === "response" && receipt.status === 200
							? { kind: "succeeded" as const }
							: { kind: "unknown" as const, message: "No success evidence" },
					...overrides,
				},
			},
		},
	});
}
export function executor(
	overrides: Partial<TransferExecutor> = {},
): TransferExecutor {
	return {
		start: async () => {
			throw new Error("Unexpected background submission");
		},
		recover: async () => {
			throw new Error("Unexpected recovery");
		},
		cancel: async () => {
			throw new Error("Unexpected cancellation");
		},
		...overrides,
	};
}
