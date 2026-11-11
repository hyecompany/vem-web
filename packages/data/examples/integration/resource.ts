// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region adapter
import type { ResourceDefinition } from "@hyecompany/vem-data/runtime";
import type { TaskRef } from "../task-board/contract.js";
import { taskRead } from "../task-board/read.js";

export const taskAdapter: ResourceDefinition = {
	...taskRead,
	sources: [
		{
			key: "all-tasks",
			mode: "list",
			fields: ["title", "status", "notes"],
			membership: true,
			async run(_request, context) {
				const records: TaskRecord[] = await readTasks("", context.signal);
				return {
					facts: records.map(taskFact),
					memberships: [
						{
							resource: "tasks",
							identities: records.map(({ id }) => ({ id })),
							complete: true,
							basis: ["public"],
						},
					],
				};
			},
		},
		{
			key: "one-task",
			mode: "one",
			fields: ["title", "status", "notes"],
			async run(request, context) {
				const path = `/${encodeURIComponent((request.identity as TaskRef).id)}`;
				const record: TaskRecord = await readTasks(path, context.signal);
				return { facts: [taskFact(record)] };
			},
		},
	],
};

// #endregion adapter

// #region extraction
import type { FactObservation } from "@hyecompany/vem-data/runtime";
import type { Task } from "../task-board/contract.js";

interface TaskRecord extends Task {
	id: string;
}
async function readTasks(path: string, signal: AbortSignal) {
	const response = await fetch(`/api/tasks${path}`, { signal });
	if (!response.ok)
		throw new Error(`Task service returned HTTP ${response.status}`);
	return response.json();
}
function taskFact(task: TaskRecord): FactObservation {
	return {
		resource: "tasks",
		identity: { id: task.id },
		values: { title: task.title, status: task.status, notes: task.notes },
		presence: "present",
		basis: ["public"],
	};
}
// #endregion extraction
