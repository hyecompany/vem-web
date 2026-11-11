// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region owner
import { createRuntime, DexiePersistence } from "@hyecompany/vem-data/runtime";
import { createSharedHost } from "@hyecompany/vem-data/worker";
import { compatibility } from "./compatibility.js";
import { taskDefinition } from "./domain.js";

const attach = createSharedHost({
	compatibility,
	lockName: "vem-task-board-owner",
	locks: navigator.locks,
	async create() {
		const client = createRuntime({
			resources: [taskDefinition],
			persistence: new DexiePersistence("vem-data:task-board:v1"),
		});
		const events = new EventSource("/api/events");
		events.onmessage = (event) => {
			try {
				client.event("tasks", JSON.parse(event.data));
			} catch (error) {
				console.error("Invalid task event", error);
			}
		};
		await new Promise<void>((resolve) => {
			events.onopen = () => {
				client.setContinuity({ channel: "task-events" }, "live");
				resolve();
			};
			events.onerror = () => {
				client.setContinuity({ channel: "task-events" }, "interrupted");
				resolve();
			};
		});
		return {
			client,
			dispose() {
				events.close();
				client.close();
			},
		};
	},
});
const scope = globalThis as unknown as {
	onconnect: (event: MessageEvent) => void;
};
scope.onconnect = (event) => {
	for (const port of event.ports) void attach.then((connect) => connect(port));
};
// #endregion owner
