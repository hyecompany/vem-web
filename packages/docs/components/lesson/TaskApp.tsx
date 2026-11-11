// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import type { QueryResult } from "@hyecompany/vem-data";
import { Check, Circle, CircleHelp, ListTodo, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Task } from "../labs/model";

export function TaskApp({
	children,
	toolbar,
	label = "Weekend plans",
}: {
	children: ReactNode;
	toolbar?: ReactNode;
	label?: string;
}) {
	return (
		<section aria-label={label} className="task-app">
			<Card className="task-window">
				<header className="task-app-header">
					<span className="app-mark">
						<ListTodo aria-hidden="true" />
					</span>
					<strong>Weekend</strong>
					<span className="app-location">/ Plans</span>
					{toolbar && <div className="app-toolbar">{toolbar}</div>}
				</header>
				<div className="task-app-body">{children}</div>
			</Card>
		</section>
	);
}
export function TaskList({
	result,
	onOpen,
	onComplete,
	busy = false,
	showNotes = false,
}: {
	result: QueryResult<Partial<Task>, { id: string }>;
	onOpen?: (id: { id: string }) => void;
	onComplete?: (id: { id: string }) => void;
	busy?: boolean;
	showNotes?: boolean;
}) {
	return (
		<>
			<ul className="app-task-list">
				{result.rows.map((row) => {
					const proposed = row.fields.status?.source === "proposed";
					const done = row.data.status === "done";
					const identity =
						row.identity.kind === "resource"
							? row.identity.resource
							: undefined;
					return (
						<li
							key={row.key}
							className="app-task"
							data-done={done && !proposed}
						>
							{onComplete && identity ? (
								<Button
									variant="ghost"
									size="icon"
									disabled={done || busy}
									aria-label={`Complete ${row.data.title ?? "task"}`}
									onClick={() => onComplete(identity)}
								>
									{done ? <Check /> : <Circle />}
								</Button>
							) : (
								<span
									className="task-check"
									role="img"
									aria-label={
										row.data.status === undefined
											? "Status unknown"
											: done
												? "Done"
												: "To do"
									}
								>
									{row.data.status === undefined ? (
										<CircleHelp aria-hidden="true" />
									) : done ? (
										<Check aria-hidden="true" />
									) : (
										<Circle aria-hidden="true" />
									)}
								</span>
							)}
							<div className="task-name">
								{onOpen && identity ? (
									<Button variant="ghost" onClick={() => onOpen(identity)}>
										{row.data.title ?? "Title unavailable"}
									</Button>
								) : (
									<strong>{row.data.title ?? "Title unavailable"}</strong>
								)}
								{showNotes && row.data.notes && (
									<p className="task-note">{row.data.notes}</p>
								)}
							</div>
							{proposed ? (
								<Badge variant="warning">Unconfirmed</Badge>
							) : done ? (
								<Badge variant="secondary">Done</Badge>
							) : null}
						</li>
					);
				})}
			</ul>
			{result.empty && (
				<div className="app-empty">
					<Check aria-hidden="true" />
					<p>Nothing to do here.</p>
				</div>
			)}
			{result.unresolved.length > 0 && (
				<section aria-label="Match not confirmed">
					<p className="task-section-label">Match not confirmed</p>
					<ul className="app-task-list">
						{result.unresolved.map((row) => (
							<li key={row.key} className="app-task">
								<CircleHelp aria-hidden="true" />
								<div className="task-name">
									<strong>{row.data.title ?? "Title unavailable"}</strong>
									{showNotes && row.data.notes && (
										<p className="task-note">{row.data.notes}</p>
									)}
								</div>
								{row.data.status && (
									<Badge variant="warning">
										{row.data.status === "done" ? "Done" : "To do"}
										{row.fields.status?.stale && " · last known"}
									</Badge>
								)}
							</li>
						))}
					</ul>
				</section>
			)}
			{result.rows.length === 0 &&
				!result.empty &&
				result.unresolved.length === 0 && (
					<p className="app-message">The task list is not available yet.</p>
				)}
		</>
	);
}
export function PrivateNote({
	value,
	missing = "You no longer have access to these notes.",
}: {
	value: string | undefined;
	missing?: string;
}) {
	return (
		<div className="private-note">
			<span>
				<LockKeyhole aria-hidden="true" />
				Private notes
			</span>
			<p>{value ?? missing}</p>
		</div>
	);
}
