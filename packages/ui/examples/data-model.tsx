// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	defineCommand,
	defineEdit,
	defineResource,
} from "@hyecompany/vem-data";

export const tasks = defineResource<
	{ title: string; notes: string },
	{ id: string }
>()({
	name: "tasks",
	fields: ["title", "notes"],
	commands: { complete: defineCommand() },
	edits: { notes: defineEdit<{ notes: string }>() },
});

// #endregion example
