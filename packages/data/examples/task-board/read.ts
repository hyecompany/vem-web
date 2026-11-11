// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region read-definition
import type { ResourceReadDefinition } from "@hyecompany/vem-data/client";

export const taskRead: ResourceReadDefinition = {
	name: "tasks",
	access: "public",
};
// #endregion read-definition
