// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	AccessRequirement,
	AccessState,
	QueryDescriptor,
	ResourceReadDefinition,
} from "../types.js";

/** Unknown permission remains distinct from evidence of denial. */
export function evaluateAccess(
	requirement: AccessRequirement | undefined,
	access: (scope: string) => AccessState,
): AccessState {
	if (requirement === undefined) return "allowed";
	if (typeof requirement === "string") return access(requirement);
	const states = ("all" in requirement ? requirement.all : requirement.any).map(
		(part) => evaluateAccess(part, access),
	);
	if ("all" in requirement) {
		if (states.includes("denied")) return "denied";
		return states.every((state) => state === "allowed") ? "allowed" : "unknown";
	}
	if (states.includes("allowed")) return "allowed";
	return states.every((state) => state === "denied") ? "denied" : "unknown";
}

export function readAccess(
	definition: ResourceReadDefinition,
	query: QueryDescriptor,
): AccessRequirement | undefined {
	return typeof definition.access === "function"
		? definition.access(query)
		: definition.access;
}
export function fieldAccess(
	definition: ResourceReadDefinition,
	field: string,
	identity: unknown,
): AccessRequirement | undefined {
	const rule = definition.fieldAccess?.[field];
	return typeof rule === "function"
		? identity === undefined
			? undefined
			: rule(identity)
		: rule;
}
export function deniedScopes(
	requirement: AccessRequirement | undefined,
	access: (scope: string) => AccessState,
): string[] {
	if (
		evaluateAccess(requirement, access) !== "denied" ||
		requirement === undefined
	)
		return [];
	if (typeof requirement === "string") return [requirement];
	return ("all" in requirement ? requirement.all : requirement.any).flatMap(
		(part) => deniedScopes(part, access),
	);
}
