// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	defineCommand,
	defineEdit,
	defineResource,
} from "../../src/contracts.js";
import { defineScenarios } from "../../src/devtools.js";

type Widget = { name: string; status: "Running" | "Stopped" };
type Identity = { name: string };
const resource = defineResource<Widget, Identity>()({
	name: "widgets",
	fields: ["name", "status"],
	commands: { state: defineCommand<{ action: "start" | "stop" }>() },
	edits: { settings: defineEdit<{ description: string }>() },
});

defineScenarios(resource, {
	example: {
		identity: { name: "one" },
		data: { name: "One", status: "Stopped" },
	},
	fields: { status: { choices: ["Running", "Stopped"] } },
	commands: {
		state: {
			input: { action: "start" },
			proposals: (command) => [
				{
					resource: command.resource,
					identity: { name: command.target.name },
					kind: "update",
					values: {
						status: command.input.action === "start" ? "Running" : "Stopped",
					},
				},
			],
		},
	},
	edits: { settings: { values: { description: "Original" } } },
});

defineScenarios(resource, {
	// @ts-expect-error Scenario resource samples use the real resource value type.
	example: { identity: { name: "one" }, data: { name: "One", status: 3 } },
});
defineScenarios(resource, {
	// @ts-expect-error Field choices must be values of the selected field.
	fields: { status: { choices: ["Missing"] } },
});
defineScenarios(resource, {
	// @ts-expect-error Scenario command inputs must satisfy the production command.
	commands: { state: { input: { action: "explode" } } },
});
defineScenarios(resource, {
	// @ts-expect-error Editor samples use the writable representation, not the read model.
	edits: { settings: { values: { status: "Running" } } },
});
