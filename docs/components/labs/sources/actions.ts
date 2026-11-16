// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionOutcome } from "@hyecompany/vem-data";
import type { ActionContext } from "@hyecompany/vem-data/runtime";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";
import { evidence, target } from "../model";

export function createActions() {
	const pending = deferred<ActionOutcome>();
	let context: ActionContext | undefined;
	let confirmed = "open";
	const client = createRuntime({
		resources: [
			{
				name: "tasks",
				access: "public",
				commands: {
					complete: {
						access: "public",
						disclosure: "public",
						project: () => [
							{
								resource: "tasks",
								identity: target,
								kind: "update",
								values: { status: "done" },
							},
						],
						async run(_command, current) {
							context = current;
							current.submitted();
							current.progress({
								completed: 0,
								total: 2,
								message: "Waiting for your next step.",
							});
							return pending.promise;
						},
					},
				},
			},
		],
	});
	client.observe(evidence());
	return {
		client,
		confirmed: () => confirmed,
		progress: () =>
			context?.progress({
				completed: 1,
				total: 2,
				message: "One step completed.",
			}),
		finish: (kind: ActionOutcome["kind"]) => {
			if (kind === "succeeded") {
				confirmed = "done";
				context?.observe(
					evidence({ title: "Plan a weekend walk", status: "done" }),
				);
				pending.resolve({ kind });
			} else if (kind === "partial") {
				context?.observe(
					evidence({
						title: "Plan a weekend walk",
						status: "open",
						notes: "Completion note was saved.",
					}),
				);
				pending.resolve({
					kind,
					value: { noteSaved: true, completed: false },
					message: "Note saved; task completion failed.",
				});
			} else if (kind === "failed")
				pending.resolve({
					kind,
					submitted: true,
					error: { message: "The source rejected completion." },
				});
			else
				pending.resolve({
					kind,
					message:
						"Response lost after submission. Completion is not established.",
				});
		},
		close: () => {
			pending.resolve({ kind: "unknown", message: "Experiment reset." });
			client.close();
		},
	};
}
