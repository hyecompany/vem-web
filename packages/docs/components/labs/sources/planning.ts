// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	type AcquisitionRequest,
	createRuntime,
	type ObservationBatch,
} from "@hyecompany/vem-data/runtime";
import type { Task } from "../model";

export type PlanningLesson = "choices" | "sharing" | "pages";
export interface ServiceRead {
	id: number;
	source: "summaries" | "one" | "all" | "page";
	label: string;
	fields: string;
	state: "reading" | "finished" | "failed";
}
export const planningTasks: Array<Task & { id: string }> = [
	{
		id: "walk",
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
	{
		id: "weather",
		title: "Check the weather",
		status: "open",
		notes: "Bring a raincoat if showers are forecast.",
	},
];

export function createPlanning(lesson: PlanningLesson) {
	let reads: readonly ServiceRead[] = [];
	const listeners = new Set<() => void>();
	let release: (() => void) | undefined;
	let reject: ((error: Error) => void) | undefined;
	const publish = () => {
		for (const listener of listeners) listener();
	};
	async function visit(
		source: ServiceRead["source"],
		label: string,
		fields: string,
		hold = false,
	) {
		const id = reads.length + 1;
		reads = [...reads, { id, source, label, fields, state: "reading" }];
		let pending: Promise<void> | undefined;
		if (hold)
			pending = new Promise<void>((resolve, fail) => {
				release = resolve;
				reject = fail;
			});
		publish();
		try {
			await pending;
		} catch (error) {
			reads = reads.map((read) =>
				read.id === id ? { ...read, state: "failed" } : read,
			);
			publish();
			throw error;
		}
		reads = reads.map((read) =>
			read.id === id ? { ...read, state: "finished" } : read,
		);
		publish();
	}
	function batch(
		records: typeof planningTasks,
		request: AcquisitionRequest,
		complete = true,
	): ObservationBatch {
		return {
			facts: records.map(({ id, ...values }) => ({
				resource: "tasks",
				identity: { id },
				values,
				presence: "present",
				basis: ["public"],
			})),
			memberships:
				request.mode === "list"
					? [
							{
								resource: "tasks",
								where: request.where,
								identities: records.map(({ id }) => ({ id })),
								complete,
								basis: ["public"],
							},
						]
					: [],
		};
	}
	const matchingTasks = (request: AcquisitionRequest) =>
		planningTasks.filter(
			(task) => !request.where?.status || task.status === request.where.status,
		);
	const client = createRuntime({
		resources: [
			{
				name: "tasks",
				access: "public",
				sources: [
					...(lesson === "pages"
						? []
						: [
								{
									key: "summaries",
									mode: "list" as const,
									fields: ["title", "status"],
									membership: true,
									async run(request: AcquisitionRequest) {
										await visit("summaries", "Task list", "Titles and status");
										const result = batch(planningTasks, request);
										return {
											...result,
											facts: result.facts?.map((fact) => ({
												...fact,
												values: {
													title: fact.values?.title,
													status: fact.values?.status,
												},
											})),
										};
									},
								},
							]),
					{
						key: "one-task",
						mode: "one",
						fields: ["title", "status", "notes"],
						...(lesson === "pages" ? { cost: 1 } : {}),
						async run(request) {
							const records = planningTasks.filter(
								(task) => task.id === (request.identity as { id: string }).id,
							);
							await visit(
								"one",
								records[0]?.title ?? "One task",
								"One task, including notes",
							);
							return batch(records, request);
						},
					},
					{
						key: "all-tasks",
						mode: "list",
						fields: ["title", "status", "notes"],
						membership: true,
						...(lesson === "pages" ? { cost: planningTasks.length } : {}),
						async run(request) {
							await visit(
								"all",
								"All task details",
								"All three tasks, including notes",
								lesson === "sharing",
							);
							return batch(planningTasks, request);
						},
					},
					...(lesson === "pages"
						? [
								{
									key: "task-pages",
									mode: "list" as const,
									fields: ["title", "status", "notes"],
									membership: true,
									filters: ["status"],
									// This simulated service charges one unit per returned task, with a one-unit minimum.
									cost: (request: AcquisitionRequest) =>
										Math.max(1, matchingTasks(request).length),
									pagination: { pageSize: 1, maxPages: 4 },
									async run(request: AcquisitionRequest) {
										const records = matchingTasks(request);
										const index = Number(request.page?.cursor ?? 0);
										await visit(
											"page",
											`${request.where?.status === "open" ? "To do" : "All tasks"} · page ${index + 1}`,
											"One matching task per page",
											index > 0,
										);
										const complete = index + 1 >= records.length;
										return {
											batch: batch(
												records.slice(index, index + 1),
												request,
												complete,
											),
											next: complete ? undefined : String(index + 1),
										};
									},
								},
							]
						: []),
				],
			},
		],
	});
	return {
		client,
		snapshot: () => reads,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		finish() {
			const done = release;
			release = undefined;
			reject = undefined;
			done?.();
		},
		fail() {
			const fail = reject;
			release = undefined;
			reject = undefined;
			fail?.(new Error("This service read failed."));
		},
		close() {
			client.close();
			release?.();
			release = undefined;
			listeners.clear();
		},
	};
}
export type PlanningSession = ReturnType<typeof createPlanning>;
