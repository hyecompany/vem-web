// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// The example backend promises HTTP 204 only after saving the complete attachment.
// #region upload-definition
import type { CommandDefinition } from "@hyecompany/vem-data/runtime";
import type { TaskRef } from "../task-board/contract.js";

export function attachmentUpload(apiOrigin: string): CommandDefinition {
	return {
		access: "public",
		disclosure: "public",
		transfer: {
			prepare(command) {
				const target = command.target as TaskRef;
				const { file } = command.input as { file: File };
				return {
					url: new URL(
						`/api/tasks/${encodeURIComponent(target.id)}/attachments/${encodeURIComponent(file.name)}`,
						apiOrigin,
					).href,
					method: "PUT",
					body: file,
					credentials: "same-origin",
				};
			},
			complete(receipt) {
				if (receipt.kind === "unknown") return receipt;
				return receipt.status === 204
					? { kind: "succeeded" }
					: {
							kind: "unknown",
							message:
								"The service did not confirm that the complete attachment was saved.",
						};
			},
		},
	};
}
// #endregion upload-definition
