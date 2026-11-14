// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { useCommand, useEdit } from "@hyecompany/vem-data/react";
import { Button, Textarea } from "@hyecompany/vem-ui";
import { bindCommand, bindText } from "@hyecompany/vem-ui/data";
import { useId } from "react";
import { tasks } from "./data-model.js";

export function ManagedNotes({ id }: { id: string }) {
	const label = useId();
	const edit = useEdit(tasks.edits.notes({ id }));
	const notes = edit.field("notes");
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (edit.canSave) edit.save();
			}}
		>
			<label htmlFor={label}>Notes</label>
			<Textarea id={label} {...bindText(notes)} />
			{notes.state !== "readable" && <p>{notes.reason}</p>}
			<Button type="submit" disabled={!edit.canSave}>
				Save notes
			</Button>
		</form>
	);
}

export function CompleteTask({ id }: { id: string }) {
	const command = useCommand(tasks.commands.complete({ id }));
	return <Button {...bindCommand(command)}>Complete task</Button>;
}
// #endregion example
