// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

export function createTaskFixture() {
	const tasks = new Map([
		[
			"welcome",
			{
				id: "welcome",
				title: "Read your first shared result",
				status: "open",
				notes: "Try editing these notes.",
				revision: 1,
			},
		],
		[
			"ship",
			{
				id: "ship",
				title: "Ship a useful feature",
				status: "open",
				notes: "Keep the component small.",
				revision: 1,
			},
		],
	]);
	const streams = new Set();
	const requests = [];
	let taskReadGate;
	let releaseTaskReads;
	const json = (res, value, status = 200, headers = {}) => {
		res.writeHead(status, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...headers,
		});
		res.end(JSON.stringify(value));
	};
	const notify = (task) => {
		for (const stream of streams)
			stream.write(`data: ${JSON.stringify(task)}\n\n`);
	};
	const body = async (req) => {
		let text = "";
		for await (const chunk of req) {
			text += chunk;
			if (text.length > 65536) throw new Error("Demo body limit exceeded");
		}
		return JSON.parse(text || "{}");
	};
	return {
		requests,
		holdTaskReads() {
			if (taskReadGate) throw new Error("Task reads are already held");
			taskReadGate = new Promise((resolve) => {
				releaseTaskReads = resolve;
			});
			return () => {
				taskReadGate = undefined;
				releaseTaskReads?.();
				releaseTaskReads = undefined;
			};
		},
		async handle(req, res) {
			const path = new URL(req.url, "http://localhost").pathname;
			if (!path.startsWith("/api/")) return false;
			requests.push({ method: req.method, path });
			if (path === "/api/events" && req.method === "GET") {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				res.write(": connected\n\n");
				streams.add(res);
				req.on("close", () => streams.delete(res));
				return true;
			}
			if (path === "/api/external-change" && req.method === "POST") {
				const task = tasks.get("welcome");
				task.notes = "Changed by another collaborator";
				task.revision++;
				notify(task);
				json(res, task);
				return true;
			}
			if (path === "/api/tasks" && req.method === "GET") {
				await taskReadGate;
				if (res.destroyed) return true;
				json(res, [...tasks.values()]);
				return true;
			}
			const match = path.match(/^\/api\/tasks\/([^/]+)(\/complete)?$/);
			const task = match && tasks.get(decodeURIComponent(match[1]));
			if (!task) {
				json(res, { message: "Task not found" }, 404);
				return true;
			}
			if (req.method === "GET") {
				json(res, task, 200, { ETag: `"${task.revision}"` });
				return true;
			}
			if (req.method === "POST" && match[2]) {
				task.status = "done";
				task.revision++;
				notify(task);
				json(res, task);
				return true;
			}
			if (req.method === "PUT" && !match[2]) {
				const input = await body(req);
				if (req.headers["if-match"] !== `"${task.revision}"`) {
					json(res, { message: "Baseline changed" }, 412);
					return true;
				}
				if (typeof input.notes !== "string") {
					json(res, { message: "Notes must be text" }, 400);
					return true;
				}
				task.notes = input.notes;
				task.revision++;
				notify(task);
				json(res, task, 200, { ETag: `"${task.revision}"` });
				return true;
			}
			json(res, { message: "Method not supported" }, 405);
			return true;
		},
		close() {
			releaseTaskReads?.();
			for (const stream of streams) stream.end();
			streams.clear();
		},
	};
}
