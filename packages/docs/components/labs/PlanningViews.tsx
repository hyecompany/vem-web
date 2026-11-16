// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useQuery } from "@hyecompany/vem-data/react";
import { Badge, Button } from "@hyecompany/vem-ui";
import { Check, Circle, FileText, PanelRight } from "lucide-react";
import { useId, useState } from "react";
import { TaskApp, TaskList } from "../lesson/TaskApp";
import { tasks } from "./model";

function Notes({ id }: { id: string }) {
	const result = useQuery(tasks.get({ id }, { select: ["notes"] }));
	return (
		<div className="planning-note">
			<FileText aria-hidden="true" />
			<p>{result.rows[0]?.data.notes ?? "Reading notes…"}</p>
		</div>
	);
}
function NotesOverview() {
	const result = useQuery(tasks.list({ select: ["notes"] }));
	const ready = result.rows.filter(
		(row) => row.data.notes !== undefined,
	).length;
	return (
		<aside className="planning-overview" aria-label="Notes overview">
			<PanelRight aria-hidden="true" />
			<div>
				<strong>
					{ready} of {result.confirmed.total ?? "…"} notes ready
				</strong>
				<p>This overview asks for the same notes.</p>
			</div>
		</aside>
	);
}
export function PlanningBoard({ sharing = false }: { sharing?: boolean }) {
	const result = useQuery(tasks.list({ select: ["title", "status"] }));
	const notesId = useId();
	const [opened, setOpened] = useState<readonly string[]>([]);
	const [overview, setOverview] = useState(false);
	const all = result.rows.flatMap((row) =>
		row.identity.kind === "resource" ? [row.identity.resource.id] : [],
	);
	return (
		<TaskApp
			label="Planning task board"
			toolbar={
				<Button
					size="sm"
					variant="outline"
					disabled={!all.length || all.every((id) => opened.includes(id))}
					onClick={() => setOpened(all)}
				>
					{all.length > 0 && all.every((id) => opened.includes(id))
						? "All notes open"
						: "Open all notes"}
				</Button>
			}
		>
			<ul className="planning-tasks">
				{result.rows.map((row) => {
					if (row.identity.kind !== "resource") return null;
					const id = row.identity.resource.id,
						open = opened.includes(id);
					return (
						<li key={row.key} data-notes-open={open}>
							<div className="planning-task-heading">
								{row.data.status === "done" ? (
									<Check aria-hidden="true" />
								) : (
									<Circle aria-hidden="true" />
								)}
								<strong>{row.data.title}</strong>
								{!sharing && (
									<Button
										size="sm"
										variant="ghost"
										aria-label={`${open ? "Close" : "Open"} ${row.data.title} notes`}
										aria-expanded={open}
										aria-controls={`${notesId}-${id}`}
										onClick={() =>
											setOpened((current) =>
												open
													? current.filter((value) => value !== id)
													: [...current, id],
											)
										}
									>
										{open ? "Close" : "Notes"}
									</Button>
								)}
							</div>
							<div id={`${notesId}-${id}`} hidden={!open}>
								{open && <Notes id={id} />}
							</div>
						</li>
					);
				})}
			</ul>
			{sharing && (
				<div className="planning-board-footer">
					<Button
						variant="outline"
						size="sm"
						disabled={!opened.length || overview}
						onClick={() => setOverview(true)}
					>
						<PanelRight aria-hidden="true" />
						Open notes overview
					</Button>
				</div>
			)}
			{overview && <NotesOverview />}
		</TaskApp>
	);
}
export function PagedPlanningBoard() {
	const [openOnly, setOpenOnly] = useState(true);
	const result = useQuery(
		tasks.list({
			select: ["title", "status", "notes"],
			where: openOnly ? { status: "open" } : undefined,
		}),
	);
	return (
		<TaskApp label="Filtered planning board">
			<div className="planning-filter-row">
				<fieldset className="task-filters" aria-label="Planning task filter">
					{[true, false].map((value) => (
						<Button
							key={String(value)}
							size="sm"
							variant={openOnly === value ? "outline" : "ghost"}
							aria-pressed={openOnly === value}
							onClick={() => setOpenOnly(value)}
						>
							{value ? "To do" : "All tasks"}
						</Button>
					))}
				</fieldset>
				<Badge variant={result.confirmed.complete ? "default" : "outline"}>
					{result.confirmed.complete
						? `${result.confirmed.total} tasks · complete`
						: `${result.confirmed.knownCount} task so far`}
				</Badge>
			</div>
			<TaskList result={result} showNotes />
		</TaskApp>
	);
}
