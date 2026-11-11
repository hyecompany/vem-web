// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region event-definition
import type { ResourceDefinition } from "@hyecompany/vem-data/runtime";

export const taskStatusEvent: ResourceDefinition["event"] = (value) => {
	if (
		typeof value !== "object" ||
		value === null ||
		!("id" in value) ||
		typeof value.id !== "string" ||
		!("status" in value) ||
		(value.status !== "open" && value.status !== "done")
	) {
		throw new Error("Invalid task status event");
	}
	return {
		facts: [
			{
				resource: "tasks",
				identity: { id: value.id },
				values: { status: value.status },
				basis: ["public"],
				liveness: { channel: "task-status" },
			},
		],
	};
};

// #endregion event-definition

// #region event-delivery
import type { Runtime } from "@hyecompany/vem-data/runtime";

export function connectedTaskEvents(runtime: Runtime) {
	runtime.setContinuity({ channel: "task-status" }, "live");
}
export function receiveTaskStatus(runtime: Runtime, payload: unknown) {
	runtime.event("tasks", payload);
}
export function lostTaskEvents(runtime: Runtime) {
	runtime.setContinuity({ channel: "task-status" }, "interrupted");
}

// #endregion event-delivery

// #region relationship
import type { ObservationBatch } from "@hyecompany/vem-data/runtime";
import type { TaskRef } from "../task-board/contract.js";

export function taskLabels(
	task: TaskRef,
	labelIds: readonly string[],
): ObservationBatch {
	return {
		relationships: [
			{
				resource: "tasks",
				identity: task,
				relationship: "labels",
				targets: labelIds.map((id) => ({
					resource: "labels",
					identity: { id },
				})),
				complete: true,
				basis: ["public"],
			},
		],
	};
}
// #endregion relationship

// #region relationship-permissions
export function protectedTaskLabels(
	task: TaskRef,
	labels: readonly { id: string; readScope: string }[],
	removedLabelIds: readonly string[] = [],
): ObservationBatch {
	const target = (id: string) => ({ resource: "labels", identity: { id } });
	return {
		relationships: [
			{
				resource: "tasks",
				identity: task,
				relationship: "labels",
				targets: labels.map((label) => target(label.id)),
				targetBasis: labels.map((label) => ({
					target: target(label.id),
					basis: [{ all: ["tasks:read-labels", label.readScope] }],
				})),
				removed: removedLabelIds.map(target),
				complete: true,
				basis: ["tasks:read-labels"],
			},
		],
	};
}
// #endregion relationship-permissions

// #region relationship-derivation
export const deriveLabelCount: ResourceDefinition["derive"] = (
	changed,
	context,
) => ({
	facts: changed.flatMap((ref) => {
		if (
			!("relationship" in ref) ||
			ref.resource !== "tasks" ||
			ref.relationship !== "labels"
		)
			return [];
		const labels = context.relationship("tasks", ref.identity, "labels");
		if (!labels?.complete || labels.stale) return [];
		return [
			{
				resource: "tasks",
				identity: ref.identity,
				values: { labelCount: labels.targets.length },
				dependsOn: [
					{ resource: "tasks", identity: ref.identity, relationship: "labels" },
				],
			},
		];
	}),
});
// #endregion relationship-derivation

// #region planned-derivation
export const taskDependencies: ResourceDefinition["fieldDependencies"] = {
	statusLabel: (identity) => [
		{
			kind: "query",
			resource: "tasks",
			mode: "one",
			identity,
			select: ["status"],
		},
	],
	labelCount: (identity) => [
		{ resource: "tasks", identity, relationship: "labels" },
	],
};
// #endregion planned-derivation

// #region related-prerequisites
export const labelNameDependencies: ResourceDefinition["fieldDependencies"] = {
	labelNames(identity, context) {
		const link = { resource: "tasks", identity, relationship: "labels" };
		const labels = context.relationship("tasks", identity, "labels");
		return [
			link,
			...(labels?.targets ?? []).map((target) => ({
				kind: "query" as const,
				resource: target.resource,
				mode: "one" as const,
				identity: target.identity,
				select: ["name"],
			})),
		];
	},
};

// #endregion related-prerequisites

// #region field-liveness
import type { FactObservation } from "@hyecompany/vem-data/runtime";
import type { TaskRecord } from "../task-board/domain.js";

export function taskWithStatusEvents(task: TaskRecord): FactObservation {
	return {
		resource: "tasks",
		identity: { id: task.id },
		values: { title: task.title, status: task.status, notes: task.notes },
		presence: "present",
		basis: ["public"],
		fieldLiveness: { status: { channel: "task-status" } },
	};
}
// #endregion field-liveness
