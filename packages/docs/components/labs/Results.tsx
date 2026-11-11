// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useQuery } from "@hyecompany/vem-data/react";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Session } from "../lesson/Session";
import { TaskApp, TaskList } from "../lesson/TaskApp";
import { QueryEvidence, Teaching } from "../lesson/Teaching";
import { evidence, tasks } from "./model";

type State = "display" | "filter" | "failed" | "empty";
const factories = Object.fromEntries(
	(["display", "filter", "failed", "empty"] as const).map((state) => [
		state,
		() => {
			let attempts = 0;
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
								async run() {
									if (state !== "failed") return;
									if (++attempts === 1)
										throw Error("The task service could not be reached.");
									return evidence();
								},
							},
						],
					},
				],
			});
			client.observe(
				state === "empty"
					? {
							memberships: [
								{
									resource: "tasks",
									identities: [],
									complete: true,
									basis: ["public"],
								},
							],
						}
					: evidence(
							state === "filter"
								? { title: "Plan a weekend walk" }
								: state === "failed"
									? { title: "Plan a weekend walk", status: "open" }
									: { status: "open" },
							state !== "failed",
						),
			);
			return { client, close: () => client.close() };
		},
	]),
) as Record<
	State,
	() => { client: ReturnType<typeof createRuntime>; close(): void }
>;
function Board({ state }: { state: State }) {
	const result = useQuery(
		tasks.list({
			select: ["title", "status"],
			where: state === "filter" ? { status: "open" } : undefined,
		}),
	);
	return (
		<>
			<Teaching learned>
				{state === "display"
					? "The service left out a title. The task still exists, so it stays in the list."
					: state === "filter"
						? "The task stays visible separately. Without its status, Vem cannot confirm it matches the To do filter."
						: state === "empty"
							? "This time, the service confirmed there are no tasks. An empty message is justified."
							: result.issues.length
								? "The connection failed. The task you already had stays visible; try again to finish the read."
								: "The retry succeeded. The task list is complete again."}
			</Teaching>
			<TaskApp>
				<div className="task-section-label">
					{state === "filter" ? "To do" : "All tasks"}
				</div>
				<TaskList result={result} />
				{result.issues.some((issue) => issue.kind === "read") && (
					<div className="service-reply">
						<span>Couldn’t finish loading the list.</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => void result.retry()}
						>
							Try again
						</Button>
					</div>
				)}
			</TaskApp>
			<QueryEvidence result={result} />
		</>
	);
}
export function Results() {
	const [state, setState] = useState<State>("display");
	return (
		<>
			<label className="situation-select">
				Task service response
				<select
					value={state}
					onChange={(event) => setState(event.target.value as State)}
				>
					<option value="display">A task without a title</option>
					<option value="filter">A task without a status</option>
					<option value="failed">A lost connection</option>
					<option value="empty">An empty list</option>
				</select>
			</label>
			<Session key={state} create={factories[state]}>
				{() => <Board state={state} />}
			</Session>
		</>
	);
}
