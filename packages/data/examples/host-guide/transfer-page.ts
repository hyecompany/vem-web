// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region transfer-page
import { attachBackgroundTransfers } from "@hyecompany/vem-data/client";
import { transferHost } from "./transfer-config.js";

export function connectUploadHost() {
	return attachBackgroundTransfers({
		serviceWorker: "/transfer-service-worker.js",
		scope: "/",
		channel: transferHost.channel,
	});
}
// #endregion transfer-page
