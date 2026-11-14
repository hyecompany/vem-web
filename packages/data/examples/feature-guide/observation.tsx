// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region cached
import { useQuery, useReadStatus } from "@hyecompany/vem-data/react";
import { type TaskRef, tasks } from "../task-board/contract.js";

export function SelectedTaskLabel({ target }: { target: TaskRef }) {
	const result = useQuery(tasks.get(target, { select: ["title"] }), {
		acquire: false,
	});
	return <span>{result.rows[0]?.data.title ?? "Selected task"}</span>;
}
// #endregion cached

// #region progress
export function TaskNotesProgress() {
	const status = useReadStatus(tasks.list({ select: ["notes"] }));
	return (
		<div>
			{status.pending && (
				<progress
					aria-label={
						status.revalidating ? "Checking notes for changes" : "Loading notes"
					}
				/>
			)}
			<div aria-live="polite">
				{status.issues.map((issue) => (
					<p key={`${issue.kind}:${issue.scope}:${issue.message}`}>
						{issue.message}
					</p>
				))}
			</div>
			{status.canRetry && (
				<button type="button" onClick={() => void status.retry()}>
					Try again
				</button>
			)}
		</div>
	);
}
// #endregion progress
