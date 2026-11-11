// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region contract
import {
	defineCommand,
	defineEdit,
	defineResource,
} from "@hyecompany/vem-data";

export interface Task {
	title: string;
	status: "open" | "done";
	notes: string;
}
export interface TaskRef {
	id: string;
}
export interface Notes {
	notes: string;
}
export const tasks = defineResource<Task, TaskRef>()({
	name: "tasks",
	fields: ["title", "status", "notes"],
	defaultSelect: ["title", "status"],
	commands: { complete: defineCommand<void, { kind: "succeeded" }>() },
	edits: { notes: defineEdit<Notes, { kind: "succeeded" }>() },
});
// #endregion contract
export const firstTask: TaskRef = { id: "welcome" };
