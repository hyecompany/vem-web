// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { type DataClient, defineResource } from "@hyecompany/vem-data";
import {
	type ClientInspector,
	inspectClient,
} from "@hyecompany/vem-data/devtools";
import { DataProvider, useQuery } from "@hyecompany/vem-data/react";
import {
	createTestClient,
	type TestClient,
} from "@hyecompany/vem-data/testing";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test } from "vitest";

const tasks = defineResource<{ title: string }, string>()({
	name: "tasks",
	fields: ["title"],
	defaultSelect: ["title"],
});
const sessions: TestClient[] = [];
const inspections: ClientInspector[] = [];

afterEach(() => {
	for (const inspection of inspections.splice(0)) inspection.close();
	for (const session of sessions.splice(0)) session.close();
});

function client(title?: string) {
	const session = createTestClient({
		queries: [
			{
				query: tasks.list(),
				...(title
					? { rows: [{ identity: "a", data: { title } }] }
					: { status: "loading" as const }),
			},
		],
	});
	const inspection = inspectClient(session.client);
	sessions.push(session);
	inspections.push(inspection);
	return { session, inspection };
}

function subscribers(inspection: ClientInspector) {
	return inspection
		.getSnapshot()
		.queries.reduce((total, query) => total + query.subscribers, 0);
}

function TaskTitles() {
	const result = useQuery(tasks.list());
	return (
		<output aria-label="Task titles">
			{result.rows.map((row) => row.data.title).join(", ")}
		</output>
	);
}

function App({ client }: { client: DataClient }) {
	return (
		<StrictMode>
			<DataProvider client={client}>
				<TaskTitles />
			</DataProvider>
		</StrictMode>
	);
}

test("replacing the provider withdraws the previous client's rows and demand before the new client is ready", async () => {
	const first = client("First account's task");
	const second = client();
	const view = render(<App client={first.inspection.client} />);
	expect(screen.getByRole("status", { name: "Task titles" }).textContent).toBe(
		"First account's task",
	);
	expect(subscribers(first.inspection)).toBe(1);

	view.rerender(<App client={second.inspection.client} />);
	expect(screen.getByRole("status", { name: "Task titles" }).textContent).toBe(
		"",
	);
	expect(subscribers(first.inspection)).toBe(0);
	expect(subscribers(second.inspection)).toBe(1);

	await act(async () => {
		first.session.setQuery({
			query: tasks.list(),
			rows: [{ identity: "a", data: { title: "Old account update" } }],
		});
	});
	expect(screen.getByRole("status", { name: "Task titles" }).textContent).toBe(
		"",
	);

	await act(async () => {
		second.session.setQuery({
			query: tasks.list(),
			rows: [{ identity: "a", data: { title: "Second account's task" } }],
		});
	});
	await waitFor(() =>
		expect(
			screen.getByRole("status", { name: "Task titles" }).textContent,
		).toBe("Second account's task"),
	);

	view.unmount();
	expect(subscribers(first.inspection)).toBe(0);
	expect(subscribers(second.inspection)).toBe(0);
});
