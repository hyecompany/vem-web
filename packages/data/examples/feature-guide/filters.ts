// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region text
import { tasks } from "../task-board/contract.js";

export function matchingTasks(text: string) {
	return tasks.list({
		select: ["title", "status"],
		where: text
			? {
					$or: [
						{ title: { contains: text, case: "insensitive" } },
						{ notes: { contains: text, case: "insensitive" } },
					],
				}
			: undefined,
	});
}
// #endregion text

// #region combined
export const openPicnicTasks = tasks.list({
	select: ["title"],
	where: {
		status: "open",
		notes: { contains: "picnic", case: "insensitive" },
	},
});
// #endregion combined
