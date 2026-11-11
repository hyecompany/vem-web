// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useQuery } from "@hyecompany/vem-data/react";
import { ArrowLeft, PanelRight } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Session } from "../lesson/Session";
import { TaskApp, TaskList } from "../lesson/TaskApp";
import { Teaching } from "../lesson/Teaching";
import { tasks } from "./model";
import { createKnowledge } from "./sources/knowledge";

function Notes({ identity }: { identity: { id: string } }) {
	const result = useQuery(tasks.get(identity, { select: ["title", "notes"] }));
	return (
		<div className="task-detail">
			<h4>{result.rows[0]?.data.title}</h4>
			<span>Notes</span>
			<p>{result.rows[0]?.data.notes ?? "Reading notes…"}</p>
		</div>
	);
}
function Overview() {
	const result = useQuery(tasks.list({ select: ["status"] }));
	const done = result.rows.filter((row) => row.data.status === "done").length;
	return (
		<aside className="app-overview" aria-label="Plan overview">
			<span>Plan overview</span>
			<strong>
				{done} of {result.confirmed.total ?? "…"}
			</strong>
			<p>tasks complete</p>
			<progress
				value={done}
				max={result.confirmed.total ?? 2}
				aria-label="Tasks complete"
			/>
		</aside>
	);
}
function Board({ session }: { session: ReturnType<typeof createKnowledge> }) {
	const [openOnly, setOpenOnly] = useState(false);
	const [filtered, setFiltered] = useState(false);
	const [detail, setDetail] = useState<{ id: string }>();
	const [overview, setOverview] = useState(false);
	const reads = useSyncExternalStore(
		(listener) => session.client.subscribe(listener),
		session.reads,
		session.reads,
	);
	const result = useQuery(
		tasks.list({
			select: ["title", "status"],
			where: openOnly ? { status: "open" } : undefined,
		}),
	);
	return (
		<>
			<Teaching
				learned={filtered || !!detail || overview}
				metric={`${reads} service ${reads === 1 ? "read" : "reads"}`}
			>
				{detail
					? "Each task’s notes are read when first opened. Returning to that task reuses its notes."
					: overview
						? "Both views use the task information already loaded. Opening the overview needs no extra read."
						: filtered
							? "The list changed immediately. Vem already knew each task’s status, so it had nothing new to read."
							: "Show just the unfinished tasks. Choose To do in the task list."}
			</Teaching>
			<TaskApp
				toolbar={
					<Button
						variant="ghost"
						size="sm"
						aria-pressed={overview}
						onClick={() => setOverview((value) => !value)}
					>
						<PanelRight aria-hidden="true" />
						Overview
					</Button>
				}
			>
				<div className="app-columns">
					<div>
						{detail ? (
							<>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setDetail(undefined)}
								>
									<ArrowLeft />
									Back to tasks
								</Button>
								<Notes identity={detail} />
							</>
						) : (
							<>
								<fieldset className="task-filters" aria-label="Filter tasks">
									{[false, true].map((value) => (
										<Button
											key={String(value)}
											size="sm"
											variant={openOnly === value ? "secondary" : "ghost"}
											aria-pressed={openOnly === value}
											onClick={() => {
												setOpenOnly(value);
												setFiltered(true);
											}}
										>
											{value ? "To do" : "All tasks"}
										</Button>
									))}
								</fieldset>
								<TaskList
									result={result}
									onOpen={(id) => {
										setDetail(id);
									}}
								/>
								{filtered && (
									<p className="app-hint">Open the walk to see its notes.</p>
								)}
							</>
						)}
					</div>
					{overview && <Overview />}
				</div>
			</TaskApp>
		</>
	);
}
export function Knowledge() {
	return (
		<Session create={createKnowledge}>
			{(session) => <Board session={session} />}
		</Session>
	);
}
