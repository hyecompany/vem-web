// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	ResourceIdentity,
	ResourceScope,
	ResourceValues,
} from "../contracts.js";
import { stableKey } from "../descriptors.js";
import type {
	ActionProjection,
	Availability,
	CommandDescriptor,
	CommandResult,
	EditDescriptor,
} from "../types.js";
import type { FieldControl, ResourceScenarios } from "./types.js";

/** @inline */
type Contract = {
	name: string;
	fields: readonly string[];
	commands: object;
	edits: object;
	get(identity: never): { scope?: unknown };
};
type BoundDescriptor<F> = F extends (
	target: infer T,
	...args: never[]
) => infer D
	? D & { target: T }
	: never;
/** @inline */
type CommandSample<F> = F extends (
	...args: never[]
) => CommandDescriptor<infer I, infer O>
	? {
			input?: I;
			availability?: Availability;
			outcome?: O;
			proposals?:
				| readonly ActionProjection[]
				| ((command: BoundDescriptor<F>) => readonly ActionProjection[]);
		}
	: never;
/** @inline */
type EditSample<F> = F extends (
	...args: never[]
) => EditDescriptor<infer T, unknown, infer O>
	? { values: T; outcome?: CommandResult<O> }
	: never;
export interface ScenarioDefinition<R extends Contract> {
	inScope?(
		identity: ResourceIdentity<R>,
		scope: ResourceScope<R>,
		values: Readonly<Partial<ResourceValues<R>>>,
	): boolean | "unknown";
	example?: {
		identity: ResourceIdentity<R>;
		scope?: ResourceScope<R>;
		data: ResourceValues<R>;
	};
	fields?: {
		[K in keyof ResourceValues<R>]?: Omit<FieldControl, "choices"> & {
			choices?: readonly ResourceValues<R>[K][];
		};
	};
	commands?: { [K in keyof R["commands"]]?: CommandSample<R["commands"][K]> };
	edits?: { [K in keyof R["edits"]]?: EditSample<R["edits"][K]> };
}

export function defineScenarios<R extends Contract>(
	contract: R,
	definition: ScenarioDefinition<R>,
): ResourceScenarios {
	return {
		name: contract.name,
		fields: contract.fields,
		inScope: (identity, scope, values) => {
			if (scope === undefined) return true;
			if (definition.inScope)
				return definition.inScope(
					identity as ResourceIdentity<R>,
					scope as ResourceScope<R>,
					values as Readonly<Partial<ResourceValues<R>>>,
				);
			try {
				const expected = contract.get(identity as never).scope;
				return expected !== undefined &&
					stableKey(expected) === stableKey(scope)
					? true
					: "unknown";
			} catch {
				return "unknown";
			}
		},
		example: definition.example as ResourceScenarios["example"],
		controls: definition.fields as ResourceScenarios["controls"],
		commands: definition.commands as ResourceScenarios["commands"],
		edits: definition.edits as ResourceScenarios["edits"],
	};
}
