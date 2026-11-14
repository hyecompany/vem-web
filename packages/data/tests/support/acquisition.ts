// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { query } from "@hyecompany/vem-data";

export const fact = (identity: string, values: Record<string, unknown>) => ({
	resource: "tasks",
	identity,
	values,
	presence: "present" as const,
	basis: ["public"],
});
export const list = query({
	resource: "tasks",
	mode: "list",
	select: ["title"],
});
