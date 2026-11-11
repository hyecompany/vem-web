// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryResult } from "@hyecompany/vem-data";
import { useCommand, useEdit, useQuery } from "@hyecompany/vem-data/react";
import { useState } from "react";
import { type TaskRef, tasks } from "./contract.js";

// #region result-status
export function ResultStatus<T extends object, I>({
	result,
}: {
	result: QueryResult<T, I> & { retry(): Promise<QueryResult<T, I>> };
}) {
	return (
		<div aria-live="polite" aria-atomic="true">
			{result.empty && <p>No matching tasks.</p>}
			{result.revalidating ? (
				<p>Checking for changes…</p>
			) : result.stale ? (
				<p>The last known result could not be confirmed.</p>
			) : result.fetching ? (
				<p>Reading missing information…</p>
			) : null}
			{result.rows.some((row) => !row.complete) && (
				<p>Some fields are unavailable; known tasks remain visible.</p>
			)}
			{result.unresolved.length > 0 && (
				<p>
					{result.unresolved.length} tasks need more information to evaluate
					this filter.
				</p>
			)}
			{result.issues.map((issue) => (
				<p key={`${issue.kind}:${issue.scope}:${issue.message}`}>
					{issue.message}
				</p>
			))}
			{result.settled &&
				!result.empty &&
				(result.stale ||
					!result.confirmed.complete ||
					result.issues.length > 0 ||
					result.rows.some((row) => !row.complete)) && (
					<button type="button" onClick={() => void result.retry()}>
						Retry
					</button>
				)}
		</div>
	);
}
// #endregion result-status

// #region command
export function CompleteTask({ target }: { target: TaskRef }) {
	const complete = useCommand(tasks.commands.complete(target));
	return (
		<button
			type="button"
			disabled={!complete.canRun}
			title={complete.availability.reason}
			onClick={() => complete.run()}
		>
			Complete task
		</button>
	);
}
// #endregion command

// #region editor
export function NotesEditor({ target }: { target: TaskRef }) {
	// #region editor-hook
	const edit = useEdit(tasks.edits.notes(target));
	// #endregion editor-hook
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (edit.canSave) edit.save();
			}}
		>
			<h3>Edit notes</h3>
			{edit.status === "loading" && <p>Preparing the baseline…</p>}
			{Object.hasOwn(edit.values, "notes") && (
				<label>
					Notes
					<textarea
						value={edit.values.notes ?? ""}
						readOnly={edit.status !== "ready"}
						onChange={(event) => edit.set("notes", event.target.value)}
					/>
				</label>
			)}
			{edit.reason && (
				<p aria-live="polite" aria-atomic="true">
					{edit.reason}
				</p>
			)}
			{edit.outcome?.kind === "failed" && (
				<p role="alert">{edit.outcome.error.message}</p>
			)}
			{edit.outcome?.kind === "unknown" && (
				<p role="alert">{edit.outcome.message}</p>
			)}
			{edit.outcome?.kind === "succeeded" && (
				<p aria-live="polite" aria-atomic="true">
					Saved.
				</p>
			)}
			<div className="actions">
				<button type="submit" disabled={!edit.canSave}>
					{edit.saving ? "Saving…" : "Save notes"}
				</button>
				<button type="button" onClick={() => void edit.reload()}>
					Discard draft and reload
				</button>
			</div>
		</form>
	);
}
// #endregion editor

export function TaskBoard() {
	const [openOnly, setOpenOnly] = useState(false);
	const [selected, setSelected] = useState<string>();
	// #region list
	const result = useQuery(
		tasks.list({
			select: ["title", "status"],
			where: openOnly ? { status: "open" } : undefined,
		}),
	);
	// #endregion list
	const row = result.rows.find((value) => value.key === selected);
	const target =
		row?.identity.kind === "resource" ? row.identity.resource : undefined;
	return (
		<section>
			<label>
				<input
					type="checkbox"
					checked={openOnly}
					onChange={(event) => setOpenOnly(event.target.checked)}
				/>{" "}
				Open tasks only
			</label>
			<ResultStatus result={result} />
			<ul className="task-list">
				{result.rows.map((row) => (
					<li key={row.key}>
						<span>
							<strong>{row.data.title ?? "Title unavailable"}</strong> ·{" "}
							{row.data.status ?? "Status unavailable"}
						</span>
						{row.identity.kind === "resource" && (
							<div className="actions">
								<CompleteTask target={row.identity.resource} />
								<button type="button" onClick={() => setSelected(row.key)}>
									Edit notes
								</button>
							</div>
						)}
					</li>
				))}
			</ul>
			{result.unresolved.length > 0 && (
				<section aria-label="Match not confirmed">
					<h3>Match not confirmed</h3>
					<ul className="task-list">
						{result.unresolved.map((row) => (
							<li key={row.key}>
								{row.data.title ?? "Title unavailable"} ·{" "}
								{row.data.status ?? "Status unavailable"}
							</li>
						))}
					</ul>
				</section>
			)}
			<p>
				{result.confirmed.complete
					? `${result.confirmed.total} confirmed matches`
					: `${result.confirmed.knownCount} confirmed matches so far`}
			</p>
			{result.activities.map((action) => (
				<p aria-live="polite" aria-atomic="true" key={action.id}>
					{action.name}:{" "}
					{action.phase === "settled"
						? action.outcome?.kind
						: (action.progress?.message ?? action.phase)}
					{action.outcome?.kind === "failed" &&
						` — ${action.outcome.error.message}`}
					{action.outcome?.kind === "unknown" && ` — ${action.outcome.message}`}
				</p>
			))}
			{target && <NotesEditor key={selected} target={target} />}
		</section>
	);
}

export function TaskNotes() {
	const result = useQuery(tasks.list({ select: ["title", "notes"] }));
	return (
		<section aria-label="Task notes">
			<h2>Task notes</h2>
			<ResultStatus result={result} />
			<ul className="task-list">
				{result.rows.map((row) => (
					<li key={row.key}>
						<strong>{row.data.title ?? "Title unavailable"}</strong>
						<p>{row.data.notes ?? "Notes unavailable"}</p>
					</li>
				))}
			</ul>
			{result.unresolved.length > 0 && (
				<section aria-label="Match not confirmed">
					<h3>Match not confirmed</h3>
					<ul className="task-list">
						{result.unresolved.map((row) => (
							<li key={row.key}>
								<strong>{row.data.title ?? "Title unavailable"}</strong>
								<p>{row.data.notes ?? "Notes unavailable"}</p>
							</li>
						))}
					</ul>
				</section>
			)}
		</section>
	);
}
