// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { Switch, VirtualList } from "@hyecompany/vem-ui";
import { useId, useState } from "react";

// #region example
interface Task {
	id: string;
	name: string;
	notes: string;
}
export function TaskList({
	tasks,
	showNotes,
}: {
	tasks: readonly Task[];
	showNotes: boolean;
}) {
	return (
		<VirtualList
			items={tasks}
			getItemKey={(task) => task.id}
			aria-label="Tasks"
			style={{ maxHeight: 240 }}
		>
			{(task) => (
				<article
					style={{
						padding: "8px 12px",
						borderBottom: "1px solid var(--border)",
					}}
				>
					<strong>{task.name}</strong>
					{showNotes && (
						<p style={{ margin: "4px 0 0", color: "var(--muted-foreground)" }}>
							{task.notes}
						</p>
					)}
				</article>
			)}
		</VirtualList>
	);
}
// #endregion example

const tasks: Task[] = Array.from({ length: 250 }, (_, index) => ({
	id: String(index),
	name: `Task ${String(index + 1).padStart(3, "0")}`,
	notes:
		[
			"Pick a day that works for everyone.",
			"Bring something to share.",
			"Check the forecast before leaving.",
		][index % 3] ?? "",
}));

export function VirtualListExample() {
	const id = useId();
	const [showNotes, setShowNotes] = useState(false);
	return (
		<div style={{ maxWidth: 420, width: "100%" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 12,
				}}
			>
				<Switch id={id} checked={showNotes} onCheckedChange={setShowNotes} />
				<label htmlFor={id}>Show notes</label>
				<span
					style={{
						marginInlineStart: "auto",
						color: "var(--muted-foreground)",
						fontSize: 13,
					}}
				>
					250 tasks
				</span>
			</div>
			<TaskList tasks={tasks} showNotes={showNotes} />
		</div>
	);
}
