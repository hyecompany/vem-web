// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { CommandButton } from "@hyecompany/vem-ui/data";
import { tasks } from "./data-model.js";

export function CompleteTaskButton({ id }: { id: string }) {
	return (
		<CommandButton command={tasks.commands.complete({ id })}>
			Complete task
		</CommandButton>
	);
}
// #endregion example
