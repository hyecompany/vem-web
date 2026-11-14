// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useEdit, useQuery } from "@hyecompany/vem-data/react";
import { Button, Input, Textarea } from "@hyecompany/vem-ui";
import { bindText } from "@hyecompany/vem-ui/data";
import { useId, useState } from "react";
import { Session } from "../lesson/Session";
import { TaskApp } from "../lesson/TaskApp";
import { Situation, Teaching } from "../lesson/Teaching";
import { target, tasks } from "./model";
import { createEditor } from "./sources/editor";

function Board({ session }: { session: ReturnType<typeof createEditor> }) {
	const id = useId();
	const edit = useEdit(tasks.edits.notes(target));
	const title = edit.field("title");
	const notes = edit.field("notes");
	const saved = useQuery(tasks.get(target, { select: ["notes"] }));
	const [external, setExternal] = useState(false);
	const [writeLost, setWriteLost] = useState(false);
	const [readLost, setReadLost] = useState(false);
	const conflict = edit.outcome?.kind === "failed";
	return (
		<>
			<Teaching
				learned={
					edit.dirty || external || !!edit.outcome || writeLost || readLost
				}
			>
				{readLost
					? "The private notes disappeared from the draft. The public title is still here."
					: writeLost
						? "You can still read your draft, but you can no longer save it."
						: conflict
							? "Your save met a newer version. Vem kept your input; you choose when to discard it."
							: edit.outcome?.kind === "succeeded"
								? "Your change is saved. Vem kept the draft and the version it was based on together."
								: external
									? "The saved note changed, but your draft stayed as you typed it. Try saving now."
									: edit.dirty
										? "Your changes belong to this draft. Save them, or try a teammate’s change below."
										: "Change the meeting time in Notes, then save the task."}
			</Teaching>
			<TaskApp>
				<form
					className="task-editor"
					onSubmit={(event) => {
						event.preventDefault();
						if (edit.canSave) edit.save();
					}}
				>
					{title.state === "readable" && (
						<label htmlFor={`${id}-title`}>
							Title
							<Input id={`${id}-title`} {...bindText(title)} />
						</label>
					)}
					{notes.state === "readable" ? (
						<label htmlFor={`${id}-notes`}>
							Notes
							<Textarea id={`${id}-notes`} {...bindText(notes)} />
						</label>
					) : (
						<p className="app-message">
							You no longer have access to these notes.
						</p>
					)}
					{conflict && (
						<p role="alert" className="app-message">
							Someone else changed this task. Your draft is still here.
						</p>
					)}
					<div className="editor-actions">
						<Button type="submit" size="sm" disabled={!edit.canSave}>
							{edit.saving ? "Saving…" : "Save changes"}
						</Button>
						{(conflict || edit.dirty || readLost) && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => void edit.reload()}
							>
								Discard & reload
							</Button>
						)}
						{edit.outcome?.kind === "succeeded" && <output>Saved</output>}
					</div>
				</form>
				{external && saved.rows[0]?.data.notes && (
					<div className="teammate-note">
						<span>Teammate’s saved note</span>
						<p>{saved.rows[0].data.notes}</p>
					</div>
				)}
			</TaskApp>
			<Situation label="Try a teammate or permission change">
				<div className="scenario-buttons">
					<Button
						variant="outline"
						size="sm"
						disabled={readLost}
						onClick={() => {
							session.external();
							setExternal(true);
						}}
					>
						Teammate saves a note
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={writeLost}
						onClick={() => {
							session.client.revoke("write");
							setWriteLost(true);
						}}
					>
						Remove save access
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={readLost}
						onClick={() => {
							session.client.revoke("notes");
							setReadLost(true);
						}}
					>
						Hide private notes
					</Button>
				</div>
			</Situation>
		</>
	);
}
export function Editor() {
	return (
		<Session create={createEditor}>
			{(session) => <Board session={session} />}
		</Session>
	);
}
