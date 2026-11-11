// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region transfer-owner
import {
	createRuntime,
	DexiePersistence,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { createBackgroundTransfers } from "@hyecompany/vem-data/worker";
import { transferHost } from "./transfer-config.js";

export function createUploadOwner(resources: readonly ResourceDefinition[]) {
	const transfers = createBackgroundTransfers(transferHost);
	const client = createRuntime({
		resources,
		persistence: new DexiePersistence(transferHost.databaseName),
		transfers,
	});
	return {
		client,
		dispose() {
			client.close();
			transfers.close();
		},
	};
}
// #endregion transfer-owner
