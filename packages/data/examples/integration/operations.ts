// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region operation-command
import type {
	ActionContext,
	ActionOutcome,
	CommandDefinition,
} from "@hyecompany/vem-data/runtime";

export function asynchronousCompletion(
	request: typeof fetch = fetch,
): CommandDefinition {
	return {
		access: "public",
		disclosure: "public",
		recovery: () => ({}),
		async run(command, context) {
			const response = await request("/api/task-operations", {
				method: "POST",
				signal: context.signal,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: command.target, action: "complete" }),
			});
			if (response.status !== 202) {
				return {
					kind: "unknown",
					message: "The service did not confirm acceptance.",
				};
			}
			const id = operationId(await response.json());
			if (!id)
				return {
					kind: "unknown",
					message: "The reply omitted its operation ID.",
				};
			await context.checkpoint({ operationId: id });
			context.submitted();
			return inspectOperation(id, context, request);
		},
		async recover(metadata, context) {
			const id = operationId(metadata);
			if (!id)
				return {
					kind: "unknown",
					message: "No operation ID was saved; investigate before retrying.",
				};
			return inspectOperation(id, context, request);
		},
	};
}
// #endregion operation-command

// #region operation-observation
async function inspectOperation(
	id: string,
	context: ActionContext,
	request: typeof fetch,
): Promise<ActionOutcome> {
	const path = `/api/task-operations/${encodeURIComponent(id)}`;
	let response = await request(path, { signal: context.signal });
	if (!response.ok)
		return { kind: "unknown", message: "Operation history is unavailable." };
	let value: unknown = await response.json();
	if (hasState(value, "running")) {
		context.progress({ message: "The service is completing the task." });
		response = await request(`${path}/wait`, { signal: context.signal });
		if (!response.ok)
			return { kind: "unknown", message: "The final reply is unavailable." };
		value = await response.json();
	}
	if (
		hasState(value, "succeeded") &&
		"taskId" in value &&
		typeof value.taskId === "string"
	) {
		context.observe({
			facts: [
				{
					resource: "tasks",
					identity: { id: value.taskId },
					presence: "present",
					values: { status: "done" },
					basis: ["public"],
				},
			],
		});
		return { kind: "succeeded" };
	}
	if (hasState(value, "failed")) {
		return {
			kind: "failed",
			submitted: true,
			error: { message: "The service could not complete the task." },
		};
	}
	return {
		kind: "unknown",
		message: "The reply did not establish a final result.",
	};
}
// #endregion operation-observation

// #region operation-decoding
function operationId(value: unknown): string | undefined {
	return typeof value === "object" &&
		value !== null &&
		"operationId" in value &&
		typeof value.operationId === "string" &&
		value.operationId.length > 0
		? value.operationId
		: undefined;
}
function hasState(
	value: unknown,
	state: string,
): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"state" in value &&
		value.state === state
	);
}
// #endregion operation-decoding
