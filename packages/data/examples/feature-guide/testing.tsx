// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region fixture
import { DataProvider } from "@hyecompany/vem-data/react";
import { createTestClient } from "@hyecompany/vem-data/testing";
import type { ReactNode } from "react";
import { tasks } from "../task-board/contract.js";
import { TaskList } from "./list.js";

export function renderPartialList(render: (view: ReactNode) => void) {
	const fixture = createTestClient({
		queries: [
			{
				query: tasks.list({ select: ["title", "status"], where: undefined }),
				rows: [
					{ identity: { id: "walk" }, data: { title: "Plan a weekend walk" } },
				],
				complete: true,
			},
		],
	});
	render(
		<DataProvider client={fixture.client}>
			<TaskList />
		</DataProvider>,
	);
	return fixture;
}
// #endregion fixture

// #region transition
export function showFailure(fixture: ReturnType<typeof createTestClient>) {
	fixture.setQuery({
		query: tasks.list({ select: ["title", "status"], where: undefined }),
		rows: [
			{ identity: { id: "walk" }, data: { title: "Plan a weekend walk" } },
		],
		status: "failed",
		error: "The task service is unavailable.",
	});
}
// #endregion transition

// #region edit-fixture
export function conflictFixture() {
	const edit = tasks.edits.notes({ id: "walk" });
	const fixture = createTestClient({
		edits: [
			{
				edit,
				values: { notes: "Meet at 10 by the river." },
				etag: '"version-1"',
				outcome: {
					kind: "failed",
					submitted: true,
					error: { code: "conflict", message: "The saved notes changed." },
				},
			},
		],
	});
	return { fixture, edit };
}
// #endregion edit-fixture

// #region edit-access
export function hideNotes({
	fixture,
	edit,
}: ReturnType<typeof conflictFixture>) {
	fixture.setEditAccess(edit, { fields: { notes: "denied" } });
}
// #endregion edit-access
