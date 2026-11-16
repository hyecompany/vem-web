// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />

// #region development
import type { DataClient } from "@hyecompany/vem-data";

export async function prepareClient(client: DataClient) {
	if (import.meta.env.DEV) {
		const { prepareDevelopmentTools } = await import("./devtools.js");
		return prepareDevelopmentTools(client);
	}
	return { client, panel: null, dispose() {} };
}
// #endregion development
