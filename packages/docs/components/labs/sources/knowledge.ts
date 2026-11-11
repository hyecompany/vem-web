// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	createRuntime,
	type ObservationBatch,
} from "@hyecompany/vem-data/runtime";
import { type Task, target } from "../model";

const records: Array<Task & { id: string }> = [
	{
		...target,
		title: "Plan a weekend walk",
		status: "open",
		notes: "Meet at 10 by the river.",
	},
	{
		id: "picnic",
		title: "Pack a picnic",
		status: "done",
		notes: "Bring sandwiches and a flask of tea.",
	},
];
export function createKnowledge() {
	let reads = 0;
	const client = createRuntime({
		resources: [
			{
				name: "tasks",
				access: "public",
				sources: [
					{
						key: "task-list",
						mode: "list",
						fields: ["title", "status"],
						membership: true,
						run: read,
					},
					{
						key: "task-detail",
						mode: "one",
						fields: ["title", "status", "notes"],
						run: read,
					},
				],
			},
		],
	});
	async function read(
		query: import("@hyecompany/vem-data/runtime").AcquisitionRequest,
	): Promise<ObservationBatch> {
		reads++;
		const selected =
			query.mode === "one"
				? records.filter(
						(record) => record.id === (query.identity as typeof target).id,
					)
				: records;
		return {
			facts: selected.map((record) => ({
				resource: "tasks",
				identity: { id: record.id },
				values: {
					title: record.title,
					status: record.status,
					...(query.mode === "one" ? { notes: record.notes } : {}),
				},
				presence: "present",
				basis: ["public"],
			})),
			memberships:
				query.mode === "list"
					? [
							{
								resource: "tasks",
								identities: records.map(({ id }) => ({ id })),
								complete: true,
								basis: ["public"],
							},
						]
					: [],
		};
	}
	return { client, reads: () => reads, close: () => client.close() };
}
