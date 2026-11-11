// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { createTestClient } from "../testing/client.js";
import type {
	CommandDescriptor,
	EditDescriptor,
	QueryDescriptor,
} from "../types.js";
import { delegateClient } from "./delegate.js";
import { scenarioFeedback } from "./feedback.js";
import { inspectClient } from "./inspect.js";
import { scenarioActions } from "./scenario-actions.js";
import { scenarioEdits } from "./scenario-edits.js";
import { scenarioQueries } from "./scenario-queries.js";
import type { ResourceScenarios, ScenarioClient } from "./types.js";

export function createScenarioClient(options: {
	resources: readonly ResourceScenarios[];
}): ScenarioClient {
	const resources = new Map(
		options.resources.map((resource) => [resource.name, resource]),
	);
	if (resources.size !== options.resources.length)
		throw new Error("Scenario resource names must be unique");
	const test = createTestClient({
		resources: [...resources.keys()],
		scopes: Object.fromEntries(
			[...resources.values()]
				.filter((resource) => resource.inScope)
				.map((resource) => [
					resource.name,
					resource.inScope as NonNullable<ResourceScenarios["inScope"]>,
				]),
		),
	});
	const queries = scenarioQueries(test, resources);
	const actions = scenarioActions(test, resources);
	const edits = scenarioEdits(test, resources);
	const source = test.client;
	const scenario = delegateClient(source, {
		watch(descriptor) {
			const handle = source.watch(descriptor);
			return {
				...handle,
				subscribe(listener) {
					const stop = handle.subscribe(listener);
					try {
						queries.ensure(descriptor as QueryDescriptor);
						return stop;
					} catch (error) {
						stop();
						throw error;
					}
				},
			};
		},
		read(descriptor, readOptions) {
			queries.ensure(descriptor as QueryDescriptor);
			return source.read(descriptor, readOptions);
		},
		availability(descriptor) {
			actions.ensure(descriptor);
			return source.availability(descriptor);
		},
		watchAvailability(descriptor) {
			actions.ensure(descriptor);
			return source.watchAvailability(descriptor);
		},
		run(descriptor, runOptions) {
			actions.ensure(descriptor as CommandDescriptor);
			return source.run(descriptor, runOptions);
		},
		async prepareEdit(descriptor) {
			edits.ensure(descriptor as EditDescriptor);
			return source.prepareEdit(descriptor);
		},
	});
	const inspector = inspectClient(scenario, { mode: "scenario" });
	const feedback = scenarioFeedback(inspector);
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		feedback.close();
		inspector.close();
		queries.close();
		actions.close();
		edits.close();
		test.close();
	};
	return {
		...inspector,
		client: delegateClient(inspector.client, { close }),
		resources: options.resources,
		feedback,
		setQuery: queries.set,
		setCommand: actions.set,
		canAdvance: actions.canAdvance,
		progress: actions.progress,
		settle: actions.settle,
		setEdit: edits.set,
		close,
	};
}
