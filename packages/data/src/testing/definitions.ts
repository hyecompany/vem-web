// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { command, commandKey, stableKey } from "../descriptors.js";
import type {
	ActionOutcome,
	CommandDefinition,
	CommandDescriptor,
	EditDefinition,
	EditDescriptor,
	Values,
} from "../types.js";
import type { CommandFixture, EditFixtureInput, TestClient } from "./types.js";

export const queryScope = (descriptor: unknown) =>
	`fixture:query:${stableKey(descriptor)}`;
export const editScope = (descriptor: unknown, field: string) =>
	`fixture:edit:${stableKey(descriptor)}:${field}`;
export const editWriteScope = (descriptor: unknown) =>
	`fixture:edit-write:${stableKey(descriptor)}`;
export const editName = (name: string) => `fixture:save:${name}`;

export function commandDefinition(
	fixtures: Map<string, CommandFixture>,
	calls: CommandDescriptor[],
): CommandDefinition {
	const find = (descriptor: CommandDescriptor) => {
		const fixture = fixtures.get(commandKey(descriptor));
		if (!fixture)
			throw new Error(
				`No command fixture for ${descriptor.resource}.${descriptor.name}`,
			);
		return fixture;
	};
	return {
		access: "public",
		disclosure: "public",
		availability: (descriptor) =>
			find(descriptor).availability ?? { state: "available" },
		project: (descriptor) => find(descriptor).proposals ?? [],
		run: async (descriptor, context) => {
			calls.push(descriptor);
			const expected = find(descriptor);
			return typeof expected.outcome === "function"
				? expected.outcome(context)
				: expected.outcome;
		},
	};
}

export function editDefinitions(
	resource: string,
	fixtures: Map<string, EditFixtureInput>,
	saves: TestClient["saves"][number][],
): { edit: EditDefinition; save: CommandDefinition } {
	const find = (descriptor: Omit<EditDescriptor, "__values">) => {
		const fixture = fixtures.get(stableKey(descriptor));
		if (!fixture) throw new Error("No edit fixture for this descriptor");
		return fixture;
	};
	return {
		edit: {
			prepare: async (descriptor) => {
				const current = find(descriptor);
				return {
					descriptor,
					values: structuredClone(current.values) as Values,
					baseline: structuredClone(current.values),
					etag: current.etag ?? null,
					disclosure: "public",
					fieldDisclosure: Object.fromEntries(
						[
							...new Set([
								...Object.keys(current.values),
								...Object.keys(current.fields ?? {}),
							]),
						].map((field) => [field, editScope(descriptor, field)]),
					),
					writeAccess: editWriteScope(descriptor),
				};
			},
			command: (prepared, values) =>
				command({
					resource,
					name: editName(prepared.descriptor.name),
					target: prepared.descriptor.target,
					input: { edit: prepared.descriptor, values, etag: prepared.etag },
				}),
		},
		save: {
			access: (descriptor) =>
				editWriteScope(
					(descriptor.input as { edit: EditFixtureInput["edit"] }).edit,
				),
			disclosure: "public",
			run: async (descriptor): Promise<ActionOutcome> => {
				const input = descriptor.input as TestClient["saves"][number];
				const current = find(input.edit);
				saves.push(structuredClone(input));
				if (input.etag !== (current.etag ?? null))
					return {
						kind: "failed",
						submitted: false,
						error: {
							code: "conflict",
							message: "The fixture baseline changed",
						},
					};
				const outcome =
					typeof current.outcome === "function"
						? await current.outcome()
						: (current.outcome ?? { kind: "succeeded" as const });
				if (outcome.kind === "succeeded")
					fixtures.set(stableKey(input.edit), {
						...current,
						values: structuredClone(input.values),
						etag: `saved:${crypto.randomUUID()}`,
					});
				return outcome;
			},
		},
	};
}
