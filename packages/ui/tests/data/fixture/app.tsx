// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	type ActionOutcome,
	type CommandDescriptor,
	command,
	edit,
	query,
} from "@hyecompany/vem-data";
import { DataProvider, useEdit, useQuery } from "@hyecompany/vem-data/react";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import {
	createTestClient,
	createTestFeedback,
	deferred,
} from "@hyecompany/vem-data/testing";
import { Button, Input, Toaster } from "@hyecompany/vem-ui";
import {
	ActivityFeedback,
	ActivityToasts,
	bindText,
	CommandButton,
	QueryStatus,
} from "@hyecompany/vem-ui/data";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@hyecompany/vem-ui/styles.css";

const description = query<{ title: string }, string>({
	resource: "tasks",
	mode: "list",
	select: ["title"],
});
const complete = command({
	resource: "tasks",
	name: "complete",
	target: "a",
	input: {},
});
const other = command({
	resource: "tasks",
	name: "complete",
	target: "b",
	input: {},
});
const notes = edit<{ title: string; notes?: string }>({
	resource: "tasks",
	name: "notes",
	target: "a",
});
const completion = deferred<ActionOutcome>();
const fixture = createTestClient({
	queries: [
		{
			query: description,
			rows: [{ identity: "a", data: { title: "Picnic" } }],
		},
	],
	commands: [
		{ command: complete, outcome: () => completion.promise },
		{ command: other, outcome: () => completion.promise },
	],
	edits: [
		{
			edit: notes,
			values: { title: "Public title", notes: "Protected notes" },
			fields: { notes: "allowed" },
		},
	],
});

let failRun = false;
const originalRun = fixture.client.run.bind(fixture.client);
fixture.client.run = <O extends ActionOutcome>(
	descriptor: CommandDescriptor<unknown, O>,
	options?: { id?: string; origin?: string },
) => {
	if (failRun) throw new Error("Protected synchronous exception details");
	return originalRun(descriptor, options);
};

const privateCompletion = deferred<ActionOutcome>();
let cancellations = 0;
const protectedRuntime = createRuntime({
	access: [{ scope: "private", state: "allowed" }],
	resources: [
		{
			name: "privateTasks",
			commands: {
				save: {
					access: "public",
					disclosure: "private",
					cancel: async () => {
						cancellations++;
						privateCompletion.resolve({
							kind: "failed",
							submitted: true,
							error: { code: "canceled", message: "Cancellation confirmed." },
						});
					},
					run: async (_command, context) => {
						context.submitted();
						context.progress({ message: "Protected progress" });
						return privateCompletion.promise;
					},
				},
			},
		},
	],
});
const protectedFeedback = createTestFeedback(protectedRuntime);
const protectedCommand = command({
	resource: "privateTasks",
	name: "save",
	target: "Confidential destination",
	input: {},
});

const controls = {
	cancellations: () => cancellations,
	failRun: (value: boolean) => {
		failRun = value;
	},
	withdraw: () => protectedRuntime.revoke("private"),
	settlePrivate: (outcome: ActionOutcome) => privateCompletion.resolve(outcome),
	settle: (outcome: ActionOutcome) => completion.resolve(outcome),
	calls: () => fixture.calls.length,
	rejectNextControl: () => {
		const observe = fixture.client.action.bind(fixture.client);
		fixture.client.action = (id) => ({
			...observe(id),
			retry: () => {
				throw new Error("Control admission changed");
			},
		});
	},
	access: (state: "unknown" | "denied" | "allowed") =>
		fixture.setEditAccess(notes, { fields: { notes: state } }),
	write: (state: "denied" | "allowed") =>
		fixture.setEditAccess(notes, { write: state }),
};
Object.assign(window, { fixture: controls });
function Section() {
	const [otherTarget, setOtherTarget] = useState(false);
	const result = useQuery(description);
	return (
		<section aria-label="Task section">
			<Button onClick={() => setOtherTarget((value) => !value)}>
				Switch command target
			</Button>
			<CommandButton command={otherTarget ? other : complete}>
				{otherTarget ? "Complete other task" : "Complete task"}
			</CommandButton>
			<QueryStatus result={result} />
			<ActivityFeedback query={description} />
		</section>
	);
}
function Editor() {
	const form = useEdit(notes);
	return (
		<section aria-label="Editor">
			<label htmlFor="title">Title</label>
			<Input id="title" {...bindText(form.field("title"))} />
			<label htmlFor="notes">Notes</label>
			<Input id="notes" {...bindText(form.field("notes"))} />
			<Button disabled={!form.canSave} onClick={() => form.save()}>
				Save notes
			</Button>
			<output aria-label="Editing state">
				{form.canEdit ? "Editable" : "Unavailable"}
			</output>
		</section>
	);
}
function PrivateApp() {
	return (
		<DataProvider client={protectedRuntime} feedback={protectedFeedback}>
			<Toaster>
				<CommandButton command={protectedCommand}>
					Save protected task
				</CommandButton>
				<ActivityToasts label={(action) => String(action.target)} />
			</Toaster>
		</DataProvider>
	);
}
function App() {
	const [open, setOpen] = useState(true);
	return (
		<DataProvider client={fixture.client}>
			<Toaster>
				<Button onClick={() => setOpen(!open)}>
					{open ? "Leave section" : "Return to section"}
				</Button>
				{open && <Section />}
				<Editor />
				<ActivityToasts label={() => "Complete task"} />
			</Toaster>
		</DataProvider>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root is missing");
createRoot(root).render(
	<StrictMode>
		{location.search.includes("protected") ? <PrivateApp /> : <App />}
	</StrictMode>,
);
