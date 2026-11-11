// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	ObservationBatch,
	ResourceContext,
	ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import type { Task, TaskRef } from "./contract.js";
import { taskRead } from "./read.js";

export interface TaskRecord extends Task {
	id: string;
}
// #region task-fact
export function taskFact(record: TaskRecord) {
	return {
		resource: "tasks",
		identity: { id: record.id },
		values: { title: record.title, status: record.status, notes: record.notes },
		presence: "present" as const,
		basis: ["public"],
		liveness: { channel: "task-events" },
	};
}
// #endregion task-fact

// #region writable-observation
interface NotesRepresentation {
	title: string;
	status: Task["status"];
	notes: string;
	etag: string;
}
function taskResponse(
	current: TaskRecord,
	response: Response,
): ObservationBatch {
	const identity = { id: current.id };
	const etag = response.headers.get("ETag");
	return {
		facts: [
			taskFact(current),
			...(etag
				? [
						{
							resource: "tasks",
							identity,
							values: {
								$notesEdit: {
									title: current.title,
									status: current.status,
									notes: current.notes,
									etag,
								} satisfies NotesRepresentation,
							},
							basis: ["public"],
							dependsOn: ["title", "status", "notes"].map((field) => ({
								resource: "tasks",
								identity,
								field,
							})),
						},
					]
				: []),
		],
	};
}
// #endregion writable-observation

// #region writable-consistency
const writableConsistency: ResourceDefinition["derive"] = (
	changed,
	context,
) => ({
	invalidate: [
		...new Map(
			changed
				.filter((ref) => ref.resource === "tasks")
				.map((ref) => [(ref.identity as TaskRef).id, ref.identity]),
		).values(),
	].flatMap((identity) => {
		const current = context.get("tasks", identity);
		const writable = current?.values.$notesEdit as
			| NotesRepresentation
			| undefined;
		if (!writable || current?.fields.$notesEdit?.stale) return [];
		const matches = ["title", "status", "notes"].every(
			(field) =>
				!current?.fields[field]?.stale &&
				current?.values[field] === writable[field as keyof NotesRepresentation],
		);
		return matches
			? []
			: [{ resource: "tasks", identity, field: "$notesEdit" }];
	}),
});
// #endregion writable-consistency
// #region command-transport
async function fetchTask(
	path: string,
	context: ResourceContext,
	init?: RequestInit,
) {
	return fetch(`/api/tasks${path}`, { ...init, signal: context.signal });
}
async function record(response: Response): Promise<TaskRecord> {
	if (!response.ok)
		throw new Error(`Task source returned HTTP ${response.status}.`);
	return response.json();
}
// #endregion command-transport
export function createTaskDefinition(
	request: typeof fetchTask = fetchTask,
): ResourceDefinition {
	return {
		...taskRead,
		// #region sources
		sources: [
			{
				key: "task-list",
				mode: "list",
				cost: 2,
				fields: ["title", "status", "notes"],
				membership: true,
				async run(_read, context) {
					const response = await request("", context);
					if (!response.ok)
						throw new Error(`Task source returned HTTP ${response.status}.`);
					const records: TaskRecord[] = await response.json();
					return {
						facts: records.map(taskFact),
						memberships: [
							{
								resource: "tasks",
								identities: records.map(({ id }) => ({ id })),
								complete: true,
								basis: ["public"],
							},
						],
					};
				},
			},
			// #region writable-source
			{
				key: "task-detail",
				mode: "one",
				fields: ["title", "status", "notes", "$notesEdit"],
				async run(read, context) {
					const response = await request(
						`/${encodeURIComponent((read.identity as TaskRef).id)}`,
						context,
					);
					return taskResponse(await record(response), response);
				},
			},
			// #endregion writable-source
		],
		// #endregion sources
		persist: (field) => ["$presence", "title", "status"].includes(field),
		derive: writableConsistency,
		event: (value) => ({
			facts: [taskFact(value as TaskRecord)],
			invalidate: [
				{
					resource: "tasks",
					identity: { id: (value as TaskRecord).id },
					field: "$notesEdit",
				},
			],
		}),
		commands: {
			// #region complete-command
			complete: {
				access: "public",
				disclosure: "public",
				availability(command, context) {
					const known = context.get("tasks", command.target);
					return known?.values.status === "done" && !known.fields.status?.stale
						? { state: "blocked", reason: "This task is already complete." }
						: { state: "available" };
				},
				project: (command) => [
					{
						resource: "tasks",
						identity: command.target,
						kind: "update",
						values: { status: "done" },
					},
				],
				async run(command, context) {
					context.progress({ message: "Completing task…" });
					const response = await request(
						`/${encodeURIComponent((command.target as TaskRef).id)}/complete`,
						context,
						{ method: "POST" },
					);
					context.observe({ facts: [taskFact(await record(response))] });
					return { kind: "succeeded" };
				},
			},
			// #endregion complete-command
			// #region save-command
			saveNotes: {
				access: "public",
				disclosure: "public",
				async run(command, context) {
					const input = command.input as { notes: string; etag: string };
					const response = await request(
						`/${encodeURIComponent((command.target as TaskRef).id)}`,
						context,
						{
							method: "PUT",
							headers: {
								"Content-Type": "application/json",
								"If-Match": input.etag,
							},
							body: JSON.stringify({ notes: input.notes }),
						},
					);
					if (response.status === 412) {
						context.observe({
							invalidate: [
								{
									resource: "tasks",
									identity: command.target,
									field: "$notesEdit",
								},
							],
						});
						return {
							kind: "failed",
							submitted: true,
							error: {
								code: "conflict",
								message:
									"The server notes changed. Your draft is preserved; reload when ready.",
							},
						};
					}
					context.observe(taskResponse(await record(response), response));
					return { kind: "succeeded" };
				},
			},
			// #endregion save-command
		},
		// #region prepare-edit
		edits: {
			notes: {
				readPrerequisites: (descriptor) => [
					{
						kind: "query",
						resource: "tasks",
						mode: "one",
						identity: descriptor.target,
						select: ["$notesEdit"],
					},
				],
				async prepare(descriptor, context) {
					const writable = context.get("tasks", descriptor.target)?.values
						.$notesEdit as NotesRepresentation | undefined;
					if (!writable)
						throw new Error(
							"The task source omitted its writable representation.",
						);
					return {
						descriptor,
						values: { notes: writable.notes },
						baseline: writable.notes,
						etag: writable.etag,
						disclosure: context.disclosure({
							resource: "tasks",
							identity: descriptor.target,
							field: "$notesEdit",
						}),
						writeAccess: "public",
					};
				},
				command: (prepared, values) => ({
					kind: "command",
					resource: "tasks",
					name: "saveNotes",
					target: prepared.descriptor.target,
					input: { notes: values.notes, etag: prepared.etag },
				}),
			},
		},
		// #endregion prepare-edit
	};
}
export const taskDefinition = createTaskDefinition();
