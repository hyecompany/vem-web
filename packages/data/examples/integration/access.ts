// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region permission-decision
import type { Runtime } from "@hyecompany/vem-data/runtime";

interface VerifiedSession {
	subject: string;
	canReadNotes: boolean;
	canEditTasks: boolean;
}
export function applySession(runtime: Runtime, session: VerifiedSession) {
	runtime.setAccess({
		contextId: session.subject,
		decisions: [
			{
				scope: "tasks:read-notes",
				state: session.canReadNotes ? "allowed" : "denied",
			},
			{
				scope: "tasks:write",
				state: session.canEditTasks ? "allowed" : "denied",
			},
		],
	});
}

// #endregion permission-decision

// #region read-permission
import type { ResourceReadDefinition } from "@hyecompany/vem-data/client";

export const protectedTaskRead: ResourceReadDefinition = {
	name: "tasks",
	access: "public",
	fieldAccess: { notes: "tasks:read-notes" },
};

// #endregion read-permission

// #region field-permission

export function protectedTaskFact(task: TaskRecord): FactObservation {
	return {
		resource: "tasks",
		identity: { id: task.id },
		presence: "present",
		values: { title: task.title, status: task.status, notes: task.notes },
		basis: ["public"],
	};
}
// #endregion field-permission

// #region revoke
export function withdrawNotes(runtime: Runtime) {
	runtime.revoke("tasks:read-notes");
}
export function leaveAccount(runtime: Runtime) {
	runtime.setAccess({
		contextId: "anonymous",
		decisions: [],
		retirePrevious: true,
	});
}

// #endregion revoke

// #region composed-proof
import type {
	FactObservation,
	ResourceContext,
} from "@hyecompany/vem-data/runtime";
import type { TaskRecord } from "../task-board/domain.js";

export function sharedNotes(
	task: TaskRecord,
	context: ResourceContext,
): FactObservation {
	return {
		resource: "tasks",
		identity: { id: task.id },
		values: { notes: task.notes },
		basis: [
			context.proof({
				all: ["signed-in", { any: ["team-member", "direct-invitation"] }],
			}),
		],
	};
}

// #endregion composed-proof

// #region source-permission
import type { AcquisitionSource } from "@hyecompany/vem-data/runtime";
import type { TaskRef } from "../task-board/contract.js";

export const privateNotesSource: AcquisitionSource = {
	key: "private-notes",
	mode: "one",
	fields: ["notes"],
	access: "tasks:read-notes",
	accessUnknown: "wait",
	async run(request, context) {
		const target = request.identity as TaskRef;
		const response = await fetch(
			`/api/tasks/${encodeURIComponent(target.id)}/notes`,
			{ signal: context.signal },
		);
		if (!response.ok)
			throw new Error(`Notes request failed (${response.status}).`);
		const body: { notes: string } = await response.json();
		return {
			facts: [
				{
					resource: "tasks",
					identity: target,
					values: { notes: body.notes },
					basis: ["public"],
				},
			],
		};
	},
};

// #endregion source-permission

// #region permission-binding
import type { AccessDecision } from "@hyecompany/vem-data/runtime";

export function taskReadBinding(
	taskId: string,
	projectId: string,
): AccessDecision {
	return {
		scope: `tasks:${taskId}:read`,
		requires: {
			all: [`projects:${projectId}:view`, `projects:${projectId}:tasks:view`],
		},
	};
}
// #endregion permission-binding
