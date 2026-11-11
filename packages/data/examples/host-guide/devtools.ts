// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region inspect
import type { DataClient } from "@hyecompany/vem-data";
import { inspectClient } from "@hyecompany/vem-data/devtools";
export function inspectDevelopmentClient(client: DataClient) {
	const inspection = inspectClient(client);
	return inspection;
}

// #endregion inspect

// #region scenarios
import {
	createScenarioClient,
	defineScenarios,
} from "@hyecompany/vem-data/devtools";
import { firstTask, tasks } from "../task-board/contract.js";

export function createTaskScenarios() {
	return createScenarioClient({
		resources: [
			defineScenarios(tasks, {
				example: {
					identity: firstTask,
					data: {
						title: "Plan a weekend walk",
						status: "open",
						notes: "Meet at 10.",
					},
				},
				fields: { status: { choices: ["open", "done"] } },
				commands: { complete: { outcome: { kind: "succeeded" } } },
				edits: { notes: { values: { notes: "Meet at 10." } } },
			}),
		],
	});
}

// #endregion scenarios

// #region scenario-change
import type { ScenarioClient } from "@hyecompany/vem-data/devtools";

export function showMissingTitles(scenario: ScenarioClient) {
	const query = scenario
		.getSnapshot()
		.queries.find(
			(item) => item.descriptor.resource === "tasks" && item.subscribers > 0,
		);
	if (query)
		scenario.setQuery(query.id, { state: "partial", missing: ["title"] });
}
// #endregion scenario-change
