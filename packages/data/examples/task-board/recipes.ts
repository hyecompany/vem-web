// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { type DataClient, hasFields } from "@hyecompany/vem-data";
import type { BrowserClient } from "@hyecompany/vem-data/client";
import type { ResourceDefinition } from "@hyecompany/vem-data/runtime";
import { createTestClient } from "@hyecompany/vem-data/testing";
import { firstTask, tasks } from "./contract.js";

// #region imperative
export async function readAndComplete(client: DataClient) {
	const result = await client.read(tasks.get(firstTask, { select: ["title"] }));
	const row = result.rows[0];
	if (!row || !hasFields(row, "title")) return result;
	const action = client.run(tasks.commands.complete(firstTask));
	const outcome = await action.result;
	return { title: row.data.title, outcome };
}
// #endregion imperative

// #region watch
export function observeTitles(
	client: DataClient,
	render: (titles: readonly (string | undefined)[]) => void,
) {
	const handle = client.watch(tasks.list({ select: ["title"] }));
	const update = () =>
		render(handle.getSnapshot().rows.map((row) => row.data.title));
	const unsubscribe = handle.subscribe(update);
	update();
	return () => {
		unsubscribe();
		handle.dispose();
	};
}
// #endregion watch

// #region fixture
export function taskFixture() {
	return createTestClient({
		queries: [
			{
				query: tasks.list({ select: ["title", "status"] }),
				rows: [{ identity: firstTask, data: { title: "Write the guide" } }],
				complete: true,
			},
		],
		commands: [
			{
				command: tasks.commands.complete(firstTask),
				outcome: {
					kind: "failed",
					submitted: false,
					error: { message: "Not admitted by the fixture." },
				},
			},
		],
	});
}
// #endregion fixture

// #region derivation
export const deriveTaskLabel: ResourceDefinition["derive"] = (
	changed,
	context,
) => ({
	facts: changed
		.filter(
			(ref) =>
				"field" in ref && ref.resource === "tasks" && ref.field === "status",
		)
		.flatMap((ref) => {
			const task = context.get("tasks", ref.identity);
			if (!task || !Object.hasOwn(task.values, "status")) return [];
			return [
				{
					resource: "tasks",
					identity: ref.identity,
					values: {
						statusLabel: task.values.status === "done" ? "Completed" : "To do",
					},
					dependsOn: [ref],
				},
			];
		}),
});
// #endregion derivation

// #region feedback
export function showInlineProgress(
	client: BrowserClient,
	actionIds: readonly string[],
) {
	return client.claimFeedback(actionIds);
}
export function dismissShownFeedback(client: BrowserClient, id: string) {
	const observed = client.listActivities().find((action) => action.id === id);
	if (observed) client.acknowledgeFeedback(id, observed);
}
// #endregion feedback

export function observationTypes(client: DataClient) {
	const descriptor = tasks.list({ select: ["title"] });
	const passive = client.watch(descriptor, { acquire: false });
	// @ts-expect-error Watching known values does not select additional fields.
	passive.getSnapshot().rows[0]?.data.notes;
	// @ts-expect-error Acquisition is a boolean option, not a cache policy name.
	client.watch(descriptor, { acquire: "cache-only" });
	const status = client.watchReadStatus(descriptor);
	// @ts-expect-error Read status observes work, not materialized query rows.
	status.getSnapshot().rows;
	const retried: Promise<void> = status.retry();
	passive.dispose();
	status.dispose();
	return retried;
}

export async function selectedTypes(client: DataClient) {
	const result = await client.read(tasks.list({ select: ["title"] }));
	// @ts-expect-error An unselected field is not part of this result.
	result.rows[0]?.data.notes;
	// @ts-expect-error Invalid command input cannot be silently accepted.
	tasks.commands.complete(firstTask, { unexpected: true });
	const row = result.rows[0];
	if (row?.identity.kind === "proposal") {
		// @ts-expect-error A proposal is not a resource target.
		tasks.commands.complete(row.identity);
	}
}
