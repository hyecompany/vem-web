// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import {
	createRuntime,
	DexiePersistence,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import {
	createBackgroundTransfers,
	createSharedHost,
} from "@hyecompany/vem-data/worker";
import { channel, compatibility, databaseName } from "./config.js";

const resource: ResourceDefinition = {
	name: "files",
	commands: {
		upload: {
			access: "public",
			disclosure: "public",
			canRetry: () => false,
			transfer: {
				prepare(command) {
					return {
						url: new URL("/upload", location.origin).href,
						method: "POST",
						body: command.input as Blob,
						headers: { "X-Transfer-Test": "yes" },
						credentials: "include",
					};
				},
				complete(receipt) {
					return receipt.kind === "response" &&
						receipt.status === 200 &&
						receipt.body === "stored"
						? { kind: "succeeded" }
						: {
								kind: "unknown",
								message: "A successful upload response was not established.",
							};
				},
			},
		},
	},
};
const attach = createSharedHost({
	compatibility,
	lockName: "vem-native-transfer-test-owner",
	locks: navigator.locks,
	async create() {
		const transfers = createBackgroundTransfers({ databaseName, channel });
		const client = createRuntime({
			resources: [resource],
			persistence: new DexiePersistence(databaseName),
			transfers,
		});
		return {
			client,
			dispose() {
				transfers.close();
				client.close();
			},
		};
	},
});
(globalThis as unknown as { onconnect(event: MessageEvent): void }).onconnect =
	(event) => {
		for (const port of event.ports)
			void attach.then((connect) => connect(port));
	};
