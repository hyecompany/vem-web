// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	ActionHandle,
	CommandResult,
	DataClient,
	QueryResult,
	ResourceIdentity,
	ResourceScope,
	ResourceValues,
} from "../../src/index.js";
import {
	command,
	defineCommand,
	defineEdit,
	defineResource,
	hasFields,
	query,
} from "../../src/index.js";
import { createTestClient } from "../../src/testing.js";

// @ts-expect-error persisted storage structures are available only from the owner entry point.
type PersistedFact = import("../src/index.js").PersistedFact;
// @ts-expect-error resource adapter contexts are not feature-facing API.
type ResourceContext = import("../src/index.js").ResourceContext;
declare const forbiddenFact: PersistedFact;
declare const forbiddenContext: ResourceContext;
void forbiddenFact;
void forbiddenContext;

interface Ref {
	project: string;
	name: string;
}
interface Thing {
	name: string;
	description: string;
	status: "running" | "stopped";
}
type SaveOutcome =
	| { kind: "succeeded"; value: { saved: true } }
	| { kind: "partial"; value: { saved: true; applied: false } }
	| { kind: "failed"; error: { message: string }; submitted: false }
	| { kind: "unknown"; message: string };
const contract = defineResource<Thing, Ref, { project: string }>()({
	name: "things",
	fields: ["name", "description", "status"],
	defaultSelect: ["name", "status"],
	defaultScope: { project: "default" },
	commands: {
		save: defineCommand<{ description: string }, SaveOutcome>(),
		start: defineCommand<
			void,
			{ kind: "succeeded"; value: { started: true } }
		>(),
		create: defineCommand<{ name: string }, SaveOutcome, { project: string }>(),
	},
	edits: { settings: defineEdit<{ description: string }>() },
});
const things = {
	...contract,
	save: (ref: Ref, description: string) =>
		contract.commands.save(ref, { description }),
};
declare const client: DataClient;
declare const snapshot: QueryResult<Pick<Thing, "name" | "status">, Ref>;
const ref = { project: "default", name: "demo" };
const selected = things.get(ref, { select: ["name", "status"] });
const watch = client.watch(selected);
const row = watch.getSnapshot().rows[0];
if (row) {
	// @ts-expect-error description was not selected.
	row.data.description;
	// @ts-expect-error partial rows do not establish a required name.
	const missingGuard: string = row.data.name;
	if (row.complete) {
		const completeName: string = row.data.name;
		void completeName;
	}
	if (hasFields(row, "name")) {
		const knownName: string = row.data.name;
		void knownName;
	}
	// @ts-expect-error a proposal/resource union is not an authoritative command target.
	things.save(row.identity, "description");
	if (row.identity.kind === "resource")
		things.save(row.identity.resource, "description");
	void missingGuard;
}
// @ts-expect-error unknown field names cannot be selected by a domain descriptor.
things.get(ref, { select: ["secret"] });
// @ts-expect-error domain command input is typed.
things.save(ref, 42);
// @ts-expect-error an incomplete identity cannot be submitted as a resource reference.
things.save({ project: "default" }, "description");
const action: ActionHandle<CommandResult<SaveOutcome>> = client.run(
	things.save(ref, "description"),
);
async function inspect() {
	const outcome = await action.result;
	if (outcome.kind === "partial") {
		const applied: false = outcome.value.applied;
		// @ts-expect-error partial success cannot be treated as fully applied.
		const success: true = outcome.value.applied;
		void applied;
		void success;
	}
	if (outcome.kind === "unknown") {
		// @ts-expect-error unknown is not a failure or an established saved value.
		outcome.value;
	}
}
const fixture = createTestClient({
	queries: [
		{ query: selected, rows: [{ identity: ref, data: { name: "demo" } }] },
	],
	commands: [
		{
			command: things.save(ref, "description"),
			outcome: { kind: "partial", value: { saved: true, applied: false } },
		},
	],
});
fixture.setQuery({
	query: selected,
	rows: [{ identity: ref, data: { name: "changed", status: "running" } }],
});
void snapshot;
void inspect;

const defaults = client.watch(things.list()).getSnapshot().rows[0];
if (defaults?.complete) {
	const name: string = defaults.data.name;
	// @ts-expect-error default selection excludes description.
	defaults.data.description;
	void name;
}
const descriptionOnly = client
	.watch(things.list({ select: ["description"] }))
	.getSnapshot().rows[0];
if (descriptionOnly?.complete) {
	const description: string = descriptionOnly.data.description;
	// @ts-expect-error a valid but unselected field is absent from the selected value type.
	descriptionOnly.data.name;
	void description;
}
const ordered = client
	.watch(things.list({ select: ["name"], orderBy: [{ field: "status" }] }))
	.getSnapshot().rows[0];
if (ordered?.complete) {
	const name: string = ordered.data.name;
	// @ts-expect-error sorting by another model field does not select it.
	ordered.data.status;
	void name;
}
const requiredScope = defineResource<Thing, Ref, { project: string }>()({
	name: "scoped",
	fields: ["name", "description", "status"],
});
// @ts-expect-error resources without a default require their declared scope.
requiredScope.list();
requiredScope.list({ scope: { project: "demo" }, select: ["name"] });
// @ts-expect-error filters use the resource's declared value types.
things.list({ where: { status: "broken" } });
// @ts-expect-error command outcomes must be valid framework outcomes.
command<void, number>({ resource: "things", name: "start", input: undefined });
const narrow = client.run(things.commands.start(ref));
async function narrowOutcome() {
	const result = await narrow.result;
	if (result.kind === "succeeded") {
		const started: true = result.value.started;
		void started;
	}
	if (result.kind === "failed") result.error.message;
	if (result.kind === "unknown") result.message;
}
things.commands.create({ project: "demo" }, { name: "new" });
// @ts-expect-error overriding a command target must preserve its target shape.
things.commands.create({ name: "invalid" }, { name: "new" });
const editor = things.edits.settings(ref);
async function editorValues() {
	const prepared = await client.prepareEdit(editor);
	const description: string = prepared.values.description;
	// @ts-expect-error editor values expose only their writable representation.
	prepared.values.status;
	void description;
}
const raw = query<Thing, Ref>({
	resource: "things",
	mode: "one",
	identity: ref,
	select: ["name"],
});
const rawRow = client.watch(raw).getSnapshot().rows[0];
if (rawRow?.complete) {
	// @ts-expect-error a raw broad model cannot claim all model fields were selected.
	const description: string = rawRow.data.description;
	void description;
}
const sample: ResourceValues<typeof contract> = {
	name: "demo",
	description: "",
	status: "running",
};
const sampleIdentity: ResourceIdentity<typeof contract> = ref;
const sampleScope: ResourceScope<typeof contract> = { project: "demo" };
void sample;
void sampleIdentity;
void sampleScope;
void narrowOutcome;
void editorValues;
