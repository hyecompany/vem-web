// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { createRuntime } from "@hyecompany/vem-data/runtime";
import { evidence, target } from "../model";

export function createEditor() {
	let title = "Plan a weekend walk";
	let notes = "Meet at 10 by the river.";
	let revision = 1;
	const client = createRuntime({
		access: [
			{ scope: "notes", state: "allowed" },
			{ scope: "write", state: "allowed" },
		],
		resources: [
			{
				name: "tasks",
				access: "public",
				commands: {
					save: {
						access: "write",
						disclosure: "notes",
						async run(command, context) {
							const input = command.input as {
								title: string;
								notes: string;
								etag: string;
							};
							if (input.etag !== String(revision))
								return {
									kind: "failed",
									submitted: true,
									error: {
										code: "conflict",
										message:
											"Someone else changed this task. Your draft is still here.",
									},
								};
							context.submitted();
							title = input.title;
							notes = input.notes;
							revision++;
							context.observe({
								facts: [
									{
										resource: "tasks",
										identity: target,
										values: { title },
										basis: ["public"],
									},
									{
										resource: "tasks",
										identity: target,
										values: { notes },
										basis: ["notes"],
									},
								],
							});
							return { kind: "succeeded" };
						},
					},
				},
				edits: {
					notes: {
						async prepare(descriptor, context) {
							return {
								descriptor,
								values: { title, notes },
								baseline: { title, notes },
								etag: String(revision),
								disclosure: "public",
								fieldDisclosure: {
									notes: context.disclosure({
										resource: "tasks",
										identity: target,
										field: "notes",
									}),
								},
								writeAccess: "write",
							};
						},
						command: (prepared, values) => ({
							kind: "command",
							resource: "tasks",
							name: "save",
							target,
							input: {
								title: values.title,
								notes: values.notes,
								etag: prepared.etag,
							},
						}),
					},
				},
			},
		],
	});
	client.observe(evidence());
	client.observe({
		facts: [
			{
				resource: "tasks",
				identity: target,
				values: { notes },
				basis: ["notes"],
			},
		],
	});
	return {
		client,
		external() {
			notes = "Meet at 11 at the north gate.";
			revision++;
			client.observe({
				facts: [
					{
						resource: "tasks",
						identity: target,
						values: { notes },
						basis: ["notes"],
					},
				],
			});
		},
		close: () => client.close(),
	};
}
