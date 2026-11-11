// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region action
import type { ActionHandle } from "@hyecompany/vem-data";
import { useAction, useCommand } from "@hyecompany/vem-data/react";
import { useState } from "react";
import { type TaskRef, tasks } from "../task-board/contract.js";

export function CompleteTask({ target }: { target: TaskRef }) {
	const complete = useCommand(tasks.commands.complete(target));
	const [action, setAction] = useState<ActionHandle>();
	if (action) return <ActionFeedback action={action} onRetry={setAction} />;
	return (
		<div>
			<button
				type="button"
				disabled={!complete.canRun}
				onClick={() => setAction(complete.run())}
			>
				Complete task
			</button>
			{complete.availability.reason && <p>{complete.availability.reason}</p>}
		</div>
	);
}
// #endregion action

// #region feedback
export function ActionFeedback({
	action,
	onRetry,
}: {
	action: ActionHandle;
	onRetry: (action: ActionHandle) => void;
}) {
	const state = useAction(action);
	const [controlError, setControlError] = useState<string>();
	const outcome = state.outcome;
	const message = !outcome
		? (state.progress?.message ?? "Working…")
		: outcome.kind === "succeeded"
			? "Task completed."
			: outcome.kind === "failed"
				? outcome.error.message
				: outcome.kind === "partial"
					? (outcome.message ?? "Only part of the change was saved.")
					: outcome.message;
	return (
		<div>
			<output>{message}</output>
			{controlError && <p role="alert">{controlError}</p>}
			{state.controls.canRetry && (
				<button type="button" onClick={() => onRetry(action.retry())}>
					Try again
				</button>
			)}
			{state.controls.canCancel && (
				<button
					type="button"
					onClick={async () => {
						try {
							await action.cancel();
						} catch {
							setControlError(
								"Cancellation could not be confirmed. Check the operation before trying again.",
							);
						}
					}}
				>
					Cancel operation
				</button>
			)}
		</div>
	);
}
// #endregion feedback
