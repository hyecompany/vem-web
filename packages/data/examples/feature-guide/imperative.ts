// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region read
import type { DataClient } from "@hyecompany/vem-data";
import { type TaskRef, tasks } from "../task-board/contract.js";

export async function readTitle(
	client: DataClient,
	target: TaskRef,
	signal: AbortSignal,
) {
	const result = await client.read(tasks.get(target, { select: ["title"] }), {
		signal,
	});
	return {
		title: result.rows[0]?.data.title,
		exists: result.exists,
		issues: result.issues,
	};
}
// #endregion read

// #region read-status
export function observeNoteReads(
	client: DataClient,
	render: (pending: boolean) => void,
) {
	const handle = client.watchReadStatus(tasks.list({ select: ["notes"] }));
	const update = () => render(handle.getSnapshot().pending);
	const unsubscribe = handle.subscribe(update);
	update();
	return () => {
		unsubscribe();
		handle.dispose();
	};
}
// #endregion read-status

// #region run
export async function completeTask(client: DataClient, target: TaskRef) {
	const action = client.run(tasks.commands.complete(target));
	return await action.result;
}
// #endregion run
