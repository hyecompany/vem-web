// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { deferred, MemoryPersistence } from "@hyecompany/vem-data/testing";
import { asynchronousCompletion } from "../../examples/integration/operations.js";
import { tasks } from "../../examples/task-board/contract.js";

test("documented operation recovery reads the saved ID and never resubmits when history disappears", async () => {
	for (const missingHistory of [false, true]) {
		const persistence = new MemoryPersistence();
		const waiting = deferred<void>();
		const held = deferred<Response>();
		const calls: string[] = [];
		let restarted = false;
		const request: typeof fetch = async (input, init) => {
			const path = String(input);
			calls.push(`${init?.method ?? "GET"} ${path}`);
			if (init?.method === "POST")
				return Response.json({ operationId: "op-42" }, { status: 202 });
			if (path.endsWith("/wait")) {
				waiting.resolve();
				return held.promise;
			}
			if (!restarted) return Response.json({ state: "running" });
			return missingHistory
				? new Response(null, { status: 404 })
				: Response.json({ state: "succeeded", taskId: "walk" });
		};
		const definition = {
			name: "tasks",
			access: () => "public",
			commands: { complete: asynchronousCompletion(request) },
		};
		const first = createRuntime({ resources: [definition], persistence });
		await first.ready;
		first.run(tasks.commands.complete({ id: "walk" }));
		await waiting.promise;
		await first.flush();
		first.close();
		restarted = true;
		held.resolve(new Response(null, { status: 404 }));
		const second = createRuntime({ resources: [definition], persistence });
		try {
			await second.ready;
			for (let i = 0; i < 100 && !second.listActivities()[0]?.outcome; i++)
				await new Promise<void>((resolve) => setImmediate(resolve));
			const action = second.listActivities()[0];
			assert.equal(
				action?.outcome?.kind,
				missingHistory ? "unknown" : "succeeded",
			);
			assert.deepEqual(calls, [
				"POST /api/task-operations",
				"GET /api/task-operations/op-42",
				"GET /api/task-operations/op-42/wait",
				"GET /api/task-operations/op-42",
			]);
			if (!missingHistory) {
				const result = await second.read(
					tasks.get({ id: "walk" }, { select: ["status"] }),
				);
				assert.equal(result.rows[0]?.data.status, "done");
			}
		} finally {
			second.close();
		}
	}
});
