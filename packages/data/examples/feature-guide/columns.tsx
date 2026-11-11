// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { hasFields } from "@hyecompany/vem-data";
import { useQuery } from "@hyecompany/vem-data/react";
import { type TaskRef, tasks } from "../task-board/contract.js";

export function NotesColumn({ target }: { target: TaskRef }) {
	// #region column
	const result = useQuery(tasks.get(target, { select: ["title", "notes"] }));
	return result.rows.map((row) => (
		<p key={row.key}>{row.data.notes ?? "Notes unavailable"}</p>
	));
	// #endregion column
}
export function PresentTitle({ target }: { target: TaskRef }) {
	const result = useQuery(tasks.get(target, { select: ["title"] }));
	// #region fields
	return result.rows.map((row) => (
		<p key={row.key}>
			{hasFields(row, "title")
				? row.data.title.toUpperCase()
				: "Title unavailable"}
		</p>
	));
	// #endregion fields
}
export function useTaskCommand({ target }: { target: TaskRef }) {
	const result = useQuery(tasks.get(target, { select: ["title"] }));
	// #region target
	const row = result.rows[0];
	const command =
		row?.identity.kind === "resource"
			? tasks.commands.complete(row.identity.resource)
			: undefined;
	// #endregion target
	return command;
}
export function SelectedFields({ target }: { target: TaskRef }) {
	const result = useQuery(tasks.get(target, { select: ["title"] }));
	// @ts-expect-error Notes must be selected before a component can read them.
	result.rows[0]?.data.notes;
	return null;
}
