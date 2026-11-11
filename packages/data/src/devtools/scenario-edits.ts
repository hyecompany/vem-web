// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type { EditFixture, TestClient } from "../testing/types.js";
import type { EditDescriptor, Values } from "../types.js";
import type { EditScenario, ResourceScenarios } from "./types.js";

export function scenarioEdits(
	test: TestClient,
	resources: ReadonlyMap<string, ResourceScenarios>,
) {
	const fixtures = new Map<string, EditFixture>();
	const set = (id: string, scenario: EditScenario) => {
		const known = fixtures.get(id);
		const current = known ? test.getEdit(known.edit) : undefined;
		if (!current)
			throw new Error(
				"Open this editor in a consumer before configuring its scenario",
			);
		const next: EditFixture = {
			...current,
			values: scenario.values
				? structuredClone(scenario.values)
				: current.values,
			etag:
				scenario.externalChange || scenario.values
					? crypto.randomUUID()
					: current.etag,
			write: scenario.write ?? current.write,
			fields: { ...current.fields, ...scenario.fields },
		};
		fixtures.set(id, next);
		test.setEdit(next);
	};
	return {
		ensure(descriptor: EditDescriptor) {
			const id = stableKey(descriptor);
			if (fixtures.has(id)) return;
			const seed = resources.get(descriptor.resource)?.edits?.[descriptor.name];
			if (!seed)
				throw new Error(
					`Add values for ${descriptor.resource}.${descriptor.name} to defineScenarios before opening this editor`,
				);
			const fixture = {
				edit: descriptor,
				values: structuredClone(seed.values) as Values,
				outcome: seed.outcome,
				etag: "scenario:initial",
			};
			fixtures.set(id, fixture);
			test.setEdit(fixture);
		},
		set,
		close() {
			fixtures.clear();
		},
	};
}
