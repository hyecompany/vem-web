// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { connectSharedWorker } from "@hyecompany/vem-data/client";
import { DataProvider } from "@hyecompany/vem-data/react";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { compatibility } from "./compatibility.js";
import ownerUrl from "./owner.ts?worker&url";
import { taskRead } from "./read.js";
import { TaskBoard, TaskNotes } from "./view.js";
import "./style.css";

// #region connect
const client = connectSharedWorker(
	new URL(ownerUrl, location.href),
	compatibility,
	{ readDefinitions: [taskRead] },
);
window.addEventListener("pagehide", (event) => {
	if (!event.persisted) client.close();
});
// #endregion connect
function Application() {
	const connection = useSyncExternalStore(
		client.subscribe,
		client.connectionSnapshot,
	);
	return (
		<main>
			<p className="eyebrow">Vem Data · runnable starter</p>
			<h1>Your task board</h1>
			<p>
				A real HTTP source, event stream, and SharedWorker. Open a second tab to
				share the same knowledge.
			</p>
			<p>
				Connection: <output>{connection.phase}</output>
			</p>
			{connection.phase === "incompatible" && (
				<p role="alert">
					Close the older task-board tabs and reopen this page to load the new
					domain definition.
				</p>
			)}
			<a href={location.href} target="_blank" rel="noreferrer">
				Open a second tab
			</a>
			<nav aria-label="Task board views" className="actions">
				<a href="?view=tasks">Tasks</a>
				<a href="?view=notes">Notes</a>
			</nav>
			<DataProvider client={client}>
				{new URLSearchParams(location.search).get("view") === "notes" ? (
					<TaskNotes />
				) : (
					<TaskBoard />
				)}
			</DataProvider>
			<details>
				<summary>Try an external update</summary>
				<p>
					While editing the first task, change its server notes. Save to see a
					real ETag conflict.
				</p>
				<button
					type="button"
					onClick={() => void fetch("/api/external-change", { method: "POST" })}
				>
					Change server notes
				</button>
				<p>
					The demo server holds fictional tasks in memory. Restarting it resets
					them. Requests and events are in the shared worker’s developer tools.
				</p>
			</details>
		</main>
	);
}
const element = document.getElementById("root");
if (!element) throw new Error("Missing root element");
createRoot(element).render(<Application />);
