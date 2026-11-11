// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	AccessRequirement,
	DisclosureBasis,
	DisclosureProof,
	GrantRef,
} from "./types.js";

export function proofLeaves(proof: DisclosureProof): GrantRef[] {
	return "scope" in proof
		? [proof]
		: ("all" in proof ? proof.all : proof.any).flatMap(proofLeaves);
}
export function proofEvery(
	proof: DisclosureProof,
	test: (ref: GrantRef) => boolean,
): boolean {
	if ("scope" in proof) return test(proof);
	return "all" in proof
		? proof.all.every((child) => proofEvery(child, test))
		: proof.any.some((child) => proofEvery(child, test));
}
export function mapProof(
	proof: DisclosureProof,
	map: (ref: GrantRef) => GrantRef,
): DisclosureProof {
	if ("scope" in proof) return map(proof);
	return "all" in proof
		? { all: proof.all.map((child) => mapProof(child, map)) }
		: { any: proof.any.map((child) => mapProof(child, map)) };
}
export function captureProof(
	requirement: AccessRequirement,
	capture: (scope: string) => GrantRef,
): DisclosureProof {
	if (typeof requirement === "string") return capture(requirement);
	return "all" in requirement
		? { all: requirement.all.map((child) => captureProof(child, capture)) }
		: { any: requirement.any.map((child) => captureProof(child, capture)) };
}
export function requirementScopes(requirement: AccessRequirement): string[] {
	return typeof requirement === "string"
		? [requirement]
		: ("all" in requirement ? requirement.all : requirement.any).flatMap(
				requirementScopes,
			);
}
export function requirementEvery(
	requirement: AccessRequirement,
	test: (scope: string) => boolean,
): boolean {
	if (typeof requirement === "string") return test(requirement);
	return "all" in requirement
		? requirement.all.every((child) => requirementEvery(child, test))
		: requirement.any.some((child) => requirementEvery(child, test));
}

export function captureBasis(
	basis: DisclosureBasis,
	capture: (scope: string) => GrantRef,
): DisclosureProof {
	if (typeof basis === "string") return capture(basis);
	if ("scope" in basis) return basis;
	return "all" in basis
		? { all: basis.all.map((part) => captureBasis(part, capture)) }
		: { any: basis.any.map((part) => captureBasis(part, capture)) };
}

export function pruneProof(
	proof: DisclosureProof,
	retain: (ref: GrantRef) => boolean,
): DisclosureProof | undefined {
	if ("scope" in proof) return retain(proof) ? proof : undefined;
	const original = "all" in proof ? proof.all : proof.any;
	const remaining = original.map((part) => pruneProof(part, retain));
	if ("all" in proof && remaining.some((part) => part === undefined))
		return undefined;
	const kept = remaining.filter(
		(part): part is DisclosureProof => part !== undefined,
	);
	if ("any" in proof && kept.length === 0) return undefined;
	if (
		kept.length === original.length &&
		kept.every((part, index) => part === original[index])
	)
		return proof;
	return "all" in proof ? { all: kept } : { any: kept };
}
