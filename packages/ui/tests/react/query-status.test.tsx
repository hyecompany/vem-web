// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineResource, type QueryResult } from "@hyecompany/vem-data";
import {
	createTestClient,
	type TestClient,
} from "@hyecompany/vem-data/testing";
import { QueryStatus } from "@hyecompany/vem-ui/data";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

type Task = { title: string; notes: string };
const tasks = defineResource<Task, string>()({
	name: "tasks",
	fields: ["title", "notes"],
	defaultSelect: ["title", "notes"],
});
const sessions: TestClient[] = [];

afterEach(() => {
	for (const session of sessions.splice(0)) session.close();
});

async function snapshot({ empty = false, failed = false } = {}) {
	const query = tasks.list();
	const session = createTestClient({
		queries: [
			{
				query,
				rows: empty
					? []
					: [
							{
								identity: "a",
								data: { title: "Plan a picnic", notes: "Bring lunch" },
							},
						],
				...(failed
					? { status: "failed" as const, error: "Task service unavailable." }
					: {}),
			},
		],
	});
	sessions.push(session);
	return session.client.read(query);
}

function TaskList({ result }: { result: QueryResult<Task, string> }) {
	return (
		<>
			<ul>
				{result.rows.map((row) => (
					<li key={row.key}>{row.data.title}</li>
				))}
			</ul>
			<QueryStatus result={result} />
		</>
	);
}

test("zero rows distinguish pending acquisition, incomplete evidence, and proven emptiness", async () => {
	const empty = await snapshot({ empty: true });
	const unresolved: QueryResult<Task, string> = {
		...empty,
		empty: false,
		confirmed: { complete: false, knownCount: 0, total: undefined },
		fetching: true,
		settled: false,
	};
	const view = render(
		<QueryStatus
			result={unresolved}
			loading="Finding tasks"
			empty="Nothing assigned"
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe("Finding tasks");

	view.rerender(
		<QueryStatus
			result={{ ...unresolved, fetching: false, settled: true }}
			empty="Nothing assigned"
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe(
		"Some information is not available yet.",
	);

	view.rerender(<QueryStatus result={empty} empty="Nothing assigned" />);
	expect(screen.getByRole("status").textContent).toBe("Nothing assigned");
});

test("unresolved candidates and missing display fields stay incomplete rather than becoming loading or empty", async () => {
	const ready = await snapshot();
	const view = render(
		<QueryStatus
			result={{
				...ready,
				rows: [],
				unresolved: ready.rows,
				confirmed: { complete: false, knownCount: 0, total: undefined },
				fetching: true,
				settled: false,
			}}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe(
		"Some information is not available yet.",
	);

	const row = ready.rows[0];
	if (!row) throw Error("Fixture must contain one task");
	view.rerender(
		<QueryStatus
			result={{
				...ready,
				rows: [
					{
						...row,
						complete: false,
						data: { title: row.data.title },
						missing: ["notes"],
					},
				],
			}}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe(
		"Some information is not available yet.",
	);
});

test("revalidation and acquisition errors complement existing rows without replacing their content", async () => {
	const ready = await snapshot();
	const view = render(<TaskList result={ready} />);
	const row = screen.getByRole("listitem");
	expect(row.textContent).toBe("Plan a picnic");
	expect(screen.queryByRole("status")).toBeNull();

	view.rerender(
		<TaskList
			result={{
				...ready,
				stale: true,
				revalidating: true,
				fetching: true,
				settled: false,
			}}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe("Updating…");
	expect(screen.getByRole("listitem")).toBe(row);

	view.rerender(<TaskList result={{ ...ready, stale: true }} />);
	expect(screen.getByRole("status").textContent).toBe("Waiting to update…");

	view.rerender(
		<TaskList
			result={{
				...ready,
				stale: true,
				issues: [{ kind: "read", message: "Task service unavailable." }],
			}}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe(
		"Task service unavailable.",
	);
	expect(screen.getByRole("listitem")).toBe(row);
});

test("retry invokes the supplied query retry and is absent while acquisition is running or retry is unavailable", async () => {
	const failed = await snapshot({ empty: true, failed: true });
	const retry = vi.fn(async () => failed);
	const user = userEvent.setup();
	const view = render(<QueryStatus result={{ ...failed, retry }} />);
	await user.click(screen.getByRole("button", { name: "Retry" }));
	expect(retry).toHaveBeenCalledTimes(1);

	view.rerender(<QueryStatus result={{ ...failed, fetching: true, retry }} />);
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	expect(screen.getByRole("status").textContent).toBe(
		"Task service unavailable.",
	);

	view.rerender(<QueryStatus result={failed} />);
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	expect(retry).toHaveBeenCalledTimes(1);
});
