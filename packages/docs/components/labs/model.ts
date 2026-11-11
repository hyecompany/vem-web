// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	defineCommand,
	defineEdit,
	defineResource,
} from "@hyecompany/vem-data";
import type { ObservationBatch } from "@hyecompany/vem-data/runtime";

export interface Task {
	title: string;
	status: "open" | "done";
	notes: string;
}
export const tasks = defineResource<Task, { id: string }>()({
	name: "tasks",
	fields: ["title", "status", "notes"],
	commands: { complete: defineCommand() },
	edits: { notes: defineEdit<{ title: string; notes: string }>() },
});
export const target = { id: "welcome" };
export function evidence(
	values: Partial<Task> = { title: "Plan a weekend walk", status: "open" },
	complete = true,
): ObservationBatch {
	return {
		facts: [
			{
				resource: "tasks",
				identity: target,
				values,
				presence: "present",
				basis: ["public"],
			},
		],
		memberships: [
			{ resource: "tasks", identities: [target], complete, basis: ["public"] },
		],
	};
}
