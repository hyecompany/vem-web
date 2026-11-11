// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import type { ActionHandle, ActionOutcome } from "@hyecompany/vem-data";
import { useAction, useCommand, useQuery } from "@hyecompany/vem-data/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Session } from "../lesson/Session";
import { TaskApp, TaskList } from "../lesson/TaskApp";
import { Situation, Teaching } from "../lesson/Teaching";
import { target, tasks } from "./model";
import { createActions } from "./sources/actions";

function Reply({
	action,
	session,
}: {
	action: ActionHandle;
	session: ReturnType<typeof createActions>;
}) {
	const value = useAction(action);
	const running = value.phase === "running";
	const outcome = value.outcome;
	return (
		<>
			{running && (
				<div className="service-reply">
					<span>The task service is waiting to reply.</span>
					<Button size="sm" onClick={() => session.finish("succeeded")}>
						Confirm completion
					</Button>
				</div>
			)}
			{running && (
				<Situation label="Try another reply">
					<div className="scenario-buttons">
						<Button variant="outline" size="sm" onClick={session.progress}>
							Send a progress update
						</Button>
						{(
							[
								["failed", "Reject the change"],
								["partial", "Save only the note"],
								["unknown", "Lose the response"],
							] as const
						).map(([kind, label]) => (
							<Button
								variant="outline"
								size="sm"
								key={kind}
								onClick={() => session.finish(kind)}
							>
								{label}
							</Button>
						))}
					</div>
					{value.progress?.completed === 1 && (
						<progress value={1} max={2} aria-label="Task progress" />
					)}
				</Situation>
			)}
			{outcome && (
				<p className="action-feedback" aria-live="polite">
					{outcome.kind === "succeeded"
						? "Task completed."
						: outcome.kind === "partial"
							? "The note was saved, but the task is still to do."
							: outcome.kind === "failed"
								? "The task service rejected the change. It is still to do."
								: "The response was lost. Completion is still unconfirmed."}
				</p>
			)}
			<details className="lesson-evidence">
				<summary>How Vem sees this</summary>
				<p>
					Service-confirmed status:{" "}
					{session.confirmed() === "done" ? "Done" : "To do"}.
				</p>
				<p>
					Action outcome: {outcome?.kind ?? "pending"}.{" "}
					{value.controls.canRetry
						? "Retry is available."
						: "No automatic retry is offered."}
				</p>
			</details>
		</>
	);
}
function SavedProgress() {
	const saved = useQuery(
		tasks.list({ select: ["status"], where: { status: "done" } }),
	);
	return (
		<aside className="app-overview" aria-label="Saved progress">
			<span>Saved progress</span>
			<strong>{saved.confirmed.knownCount} done</strong>
			<p>confirmed by the service</p>
		</aside>
	);
}
function Board({ session }: { session: ReturnType<typeof createActions> }) {
	const command = useCommand(tasks.commands.complete(target));
	const result = useQuery(tasks.list({ select: ["title", "status", "notes"] }));
	const [action, setAction] = useState<ActionHandle>();
	const current = result.activities.find((item) => item.id === action?.id);
	const outcome = current?.outcome?.kind;
	const explanations: Partial<Record<ActionOutcome["kind"], string>> = {
		succeeded:
			"Now the service has confirmed the change. The checkmark is backed by saved data.",
		partial:
			"One part succeeded. Vem keeps that result instead of saying the whole operation failed.",
		failed:
			"The preview is gone. Vem shows the latest confirmed task, without restoring an old snapshot.",
		unknown:
			"No reply does not mean no change. Vem keeps the preview labeled unconfirmed instead of guessing.",
	};
	return (
		<>
			<Teaching learned={!!action}>
				{outcome
					? explanations[outcome]
					: action
						? "The checkmark changed, but saved progress hasn’t. Let the task service confirm the change below."
						: "Mark the walk as complete using the circle beside it."}
			</Teaching>
			<TaskApp>
				<div className="app-columns">
					<div>
						<TaskList
							showNotes
							result={result}
							busy={!!action}
							onComplete={() => {
								if (command.canRun) setAction(command.run());
							}}
						/>
					</div>
					<SavedProgress />
				</div>
			</TaskApp>
			{action && <Reply action={action} session={session} />}
		</>
	);
}
export function Actions() {
	return (
		<Session create={createActions}>
			{(session) => <Board session={session} />}
		</Session>
	);
}
