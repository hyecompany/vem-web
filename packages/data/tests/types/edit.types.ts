// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineEdit, defineResource } from "../../src/contracts.js";
import { edit } from "../../src/descriptors.js";
import { defineScenarios } from "../../src/devtools.js";
import { useEdit } from "../../src/react.js";
import type {
	ActionHandle,
	CommandResult,
	DataClient,
} from "../../src/types.js";

type Form = { description: string };
type SaveOutcome =
	| { kind: "succeeded"; value: { stored: Form } }
	| { kind: "partial"; value: { stored: Form; application: "unconfirmed" } };
const resources = defineResource<Form, string>()({
	name: "profiles",
	fields: ["description"],
	edits: { settings: defineEdit<Form, SaveOutcome>() },
});
const descriptor = resources.edits.settings("default");
declare const client: DataClient;

async function imperative() {
	const prepared = await client.prepareEdit(descriptor);
	const action: ActionHandle<CommandResult<SaveOutcome>> = client.saveEdit(
		prepared,
		{ description: "Edited" },
	);
	const outcome = await action.result;
	if (outcome.kind === "partial") {
		const application: "unconfirmed" = outcome.value.application;
		const text: string = outcome.value.stored.description;
		// @ts-expect-error A partial result cannot invent which downstream instances failed.
		outcome.value.failedInstances;
		void [application, text];
	}
	if (outcome.kind === "failed") outcome.error.message;
	if (outcome.kind === "unknown") outcome.message;
}
function Screen() {
	const form = useEdit(descriptor);
	const save: () => ActionHandle<CommandResult<SaveOutcome>> = form.save;
	if (form.outcome?.kind === "partial") {
		const application: "unconfirmed" = form.outcome.value.application;
		void application;
	}
	return save;
}
const raw = edit<Form, string, SaveOutcome>({
	resource: "profiles",
	name: "settings",
	target: "default",
});
const defaultEditor = edit<Form>({
	resource: "profiles",
	name: "settings",
	target: "default",
});
defineScenarios(resources, {
	edits: {
		settings: {
			values: { description: "Original" },
			outcome: {
				kind: "partial",
				value: {
					stored: { description: "Edited" },
					application: "unconfirmed",
				},
			},
		},
	},
});
defineScenarios(resources, {
	edits: {
		settings: {
			values: { description: "Original" },
			// @ts-expect-error Editor scenario outcomes follow the declared save result type.
			outcome: { kind: "partial", value: { wrong: true } },
		},
	},
});
void [imperative, Screen, raw, defaultEditor];
