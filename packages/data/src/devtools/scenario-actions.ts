// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { commandKey } from "../descriptors.js";
import { deferred } from "../testing/memory.js";
import type { TestClient } from "../testing/types.js";
import type {
	ActionContext,
	ActionOutcome,
	ActionSnapshot,
	CommandDescriptor,
} from "../types.js";
import type { CommandScenario, ResourceScenarios } from "./types.js";

export function scenarioActions(
	test: TestClient,
	resources: ReadonlyMap<string, ResourceScenarios>,
) {
	const descriptors = new Map<string, CommandDescriptor>();
	const settings = new Map<string, CommandScenario>();
	const active = new Map<
		string,
		{ context: ActionContext; finish: (outcome: ActionOutcome) => void }
	>();
	const set = (id: string, change: CommandScenario) => {
		const descriptor = descriptors.get(id);
		if (!descriptor)
			throw new Error(
				"Use this command in a consumer before configuring its scenario",
			);
		const scenario = { ...settings.get(id), ...change };
		settings.set(id, scenario);
		test.setOutcome({
			command: descriptor,
			availability: scenario.availability,
			proposals: scenario.proposals,
			outcome: async (context) => {
				context.submitted();
				context.progress({
					message: "Running in the isolated scenario runtime",
				});
				if (!scenario.pending) return scenario.outcome ?? { kind: "succeeded" };
				const wait = deferred<ActionOutcome>();
				active.set(context.actionId, { context, finish: wait.resolve });
				try {
					return await wait.promise;
				} finally {
					active.delete(context.actionId);
				}
			},
		});
	};
	return {
		ensure(descriptor: CommandDescriptor) {
			const id = commandKey(descriptor);
			if (descriptors.has(id)) return;
			descriptors.set(id, descriptor);
			const seed = resources.get(descriptor.resource)?.commands?.[
				descriptor.name
			];
			set(id, {
				pending: false,
				availability: seed?.availability,
				outcome: seed?.outcome,
				proposals:
					typeof seed?.proposals === "function"
						? seed.proposals(descriptor)
						: seed?.proposals,
			});
		},
		set,
		canAdvance: (actionId: string) => active.has(actionId),
		progress(
			actionId: string,
			progress: NonNullable<ActionSnapshot["progress"]>,
		) {
			const action = active.get(actionId);
			if (!action) return false;
			action.context.progress(progress);
			return true;
		},
		settle(actionId: string, outcome: ActionOutcome) {
			const action = active.get(actionId);
			if (!action) return false;
			action.finish(outcome);
			return true;
		},
		close() {
			for (const action of active.values())
				action.finish({
					kind: "unknown",
					message: "The isolated scenario runtime closed",
				});
			active.clear();
			descriptors.clear();
			settings.clear();
		},
	};
}
