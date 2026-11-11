// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region editor
import { useEdit } from "@hyecompany/vem-data/react";
import { type TaskRef, tasks } from "../task-board/contract.js";

export function NotesEditor({ target }: { target: TaskRef }) {
	const edit = useEdit(tasks.edits.notes(target));
	const conflict =
		edit.outcome?.kind === "failed" && edit.outcome.error.code === "conflict";
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (edit.canSave) edit.save();
			}}
		>
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
			{edit.status === "loading" && <p>Reading the saved notes…</p>}
			{edit.reason && <p aria-live="polite">{edit.reason}</p>}
			{edit.outcome?.kind === "failed" && (
				<p role="alert">
					{conflict
						? "The saved notes changed. Your draft is still here."
						: edit.outcome.error.message}
				</p>
			)}
			{edit.outcome?.kind === "unknown" && (
				<p role="alert">{edit.outcome.message}</p>
			)}
			{edit.outcome?.kind === "succeeded" && <output>Saved.</output>}
			<button type="submit" disabled={!edit.canSave}>
				{edit.saving ? "Saving…" : "Save notes"}
			</button>
			<button
				type="button"
				disabled={edit.saving || edit.status === "loading"}
				onClick={() => void edit.reload()}
			>
				Discard draft and reload
			</button>
		</form>
	);
}
// #endregion editor
