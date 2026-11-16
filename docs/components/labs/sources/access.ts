// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { createRuntime } from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";
import { evidence, target } from "../model";

export function createAccess() {
	const response = deferred<void>();
	const started = deferred<void>();
	const currentResponse = deferred<void>();
	let holdNext = false;
	let pauseCurrent = false;
	let currentNotes = "Meet at 10 by the river.";
	const client = createRuntime({
		access: [
			{ scope: "team", state: "allowed" },
			{ scope: "owner", state: "allowed" },
		],
		resources: [
			{
				name: "tasks",
				fieldAccess: { notes: { any: ["team", "owner"] } },
				sources: [
					{
						key: "task-notes",
						mode: "one",
						fields: ["notes"],
						access: { any: ["team", "owner"] },
						async run(_query, context) {
							const basis = [context.basis("team"), context.basis("owner")];
							const held = holdNext;
							holdNext = false;
							if (held) {
								started.resolve();
								await response.promise;
							} else if (pauseCurrent) await currentResponse.promise;
							return {
								facts: [
									{
										resource: "tasks",
										identity: target,
										values: {
											notes: held ? "Old delayed notes" : currentNotes,
										},
										basis,
									},
								],
							};
						},
					},
				],
			},
		],
	});
	client.observe(evidence());
	client.observe({
		facts: [
			{
				resource: "tasks",
				identity: target,
				values: { notes: "Meet at 10 by the river." },
				basis: ["team", "owner"],
			},
		],
	});
	return {
		client,
		started: started.promise,
		response,
		holdReply() {
			holdNext = true;
			pauseCurrent = true;
			client.observe({
				invalidate: [{ resource: "tasks", identity: target, field: "notes" }],
			});
		},
		sendUpdate() {
			currentNotes = "New invitation: meet at the south gate.";
			pauseCurrent = false;
			client.observe({
				facts: [
					{
						resource: "tasks",
						identity: target,
						values: { notes: currentNotes },
						basis: ["team", "owner"],
					},
				],
			});
			currentResponse.resolve();
		},
		close: () => {
			response.resolve();
			currentResponse.resolve();
			client.close();
		},
	};
}
