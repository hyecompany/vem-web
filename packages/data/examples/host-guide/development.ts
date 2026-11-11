// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region development
import type { DataClient } from "@hyecompany/vem-data";
export async function prepareClient(client: DataClient) {
	if (import.meta.env.DEV) {
		const { inspectDevelopmentClient } = await import("./devtools.js");
		const inspection = inspectDevelopmentClient(client);
		return { client: inspection.client, inspection };
	}
	return { client };
}
// #endregion development
