// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region deadline
import type { DataClient } from "@hyecompany/vem-data";
import { firstTask, tasks } from "../task-board/contract.js";
export function readTaskWithDeadline(client: DataClient) {
	return client.read(tasks.get(firstTask, { select: ["title"] }), {
		signal: AbortSignal.timeout(10_000),
	});
}

// #endregion deadline

// #region sample
import { defineResource } from "@hyecompany/vem-data";

export const machines = defineResource<{ usage: number }, { id: string }>()({
	name: "machines",
	fields: ["usage"],
});
export const measuredUsage = machines.get(
	{ id: "web" },
	{
		select: ["usage"],
		sample: { fields: ["usage"], intervalMs: 1000 },
	},
);
// #endregion sample
