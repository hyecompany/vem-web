// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ActionHandle } from "@hyecompany/vem-data";
import { useQuery } from "@hyecompany/vem-data/react";
import {
	createTestClient,
	createTestFeedback,
} from "@hyecompany/vem-data/testing";
import { Button, createToastManager, Toaster } from "@hyecompany/vem-ui";
import {
	ActivityFeedback,
	ActivityToasts,
	CommandButton,
	QueryStatus,
} from "@hyecompany/vem-ui/data";
import { useState } from "react";
import { ManagedNotes } from "../../../ui/examples/data-bindings";
import { target, tasks } from "../labs/model";
import { createActions } from "../labs/sources/actions";
import { createEditor } from "../labs/sources/editor";
import { Session } from "../lesson/Session";

function createActionPreview() {
	const session = createActions();
	const feedback = createTestFeedback(session.client);
	return {
		...session,
		feedback,
		close() {
			feedback.close();
			session.close();
		},
	};
}
function InlineAction({ action }: { action: ActionHandle }) {
	return (
		<ActivityFeedback actionIds={[action.id]} label="Completing the walk" />
	);
}
function ActionControls({
	session,
	notifications = false,
}: {
	session: ReturnType<typeof createActionPreview>;
	notifications?: boolean;
}) {
	const [action, setAction] = useState<ActionHandle>();
	const [toasts] = useState(() => createToastManager());
	const [inline, setInline] = useState(true);
	return (
		<Toaster toastManager={toasts}>
			<div className="component-preview-actions">
				<CommandButton
					command={tasks.commands.complete(target)}
					onAction={setAction}
					disabled={!!action}
				>
					Complete the walk
				</CommandButton>
				{action && (
					<>
						<Button onClick={() => session.finish("succeeded")}>
							Confirm completion
						</Button>
						<Button onClick={() => session.finish("unknown")}>
							Lose the response
						</Button>
					</>
				)}
			</div>
			{action && inline && <InlineAction action={action} />}
			{notifications && action && (
				<Button variant="ghost" onClick={() => setInline((value) => !value)}>
					{inline ? "Show in notifications" : "Show on this page"}
				</Button>
			)}
			<ActivityToasts label={() => "Completing the walk"} />
		</Toaster>
	);
}
export function ActionPreview() {
	return (
		<Session create={createActionPreview}>
			{(session) => <ActionControls session={session} />}
		</Session>
	);
}
export function FeedbackPreview() {
	return (
		<Session create={createActionPreview}>
			{(session) => <ActionControls session={session} notifications />}
		</Session>
	);
}

const query = tasks.list({ select: ["title"] });
function createQueryPreview() {
	return createTestClient({
		queries: [
			{
				query,
				rows: [{ identity: target, data: { title: "Plan a weekend walk" } }],
				complete: false,
			},
		],
	});
}
function QueryControls({
	session,
}: {
	session: ReturnType<typeof createQueryPreview>;
}) {
	const result = useQuery(query);
	return (
		<>
			<ul>
				{result.rows.map((row) => (
					<li key={row.key}>{row.data.title ?? "Title unavailable"}</li>
				))}
			</ul>
			<QueryStatus result={result} empty="No tasks yet." />
			<div className="component-preview-actions">
				<Button
					onClick={() =>
						session.setQuery({
							query,
							rows: [
								{ identity: target, data: { title: "Plan a weekend walk" } },
							],
							status: "ready",
						})
					}
				>
					Complete the list
				</Button>
				<Button
					onClick={() => session.setQuery({ query, rows: [], status: "ready" })}
				>
					Return no tasks
				</Button>
				<Button
					onClick={() =>
						session.setQuery({
							query,
							rows: [],
							status: "failed",
							error: "Task service unavailable.",
						})
					}
				>
					Fail the read
				</Button>
			</div>
		</>
	);
}
export function QueryPreview() {
	return (
		<Session create={createQueryPreview}>
			{(session) => <QueryControls session={session} />}
		</Session>
	);
}
export function EditPreview() {
	return (
		<Session create={createEditor}>
			{(session) => (
				<>
					<ManagedNotes id="welcome" />
					<div className="component-preview-actions">
						<Button onClick={() => session.client.revoke("write")}>
							Remove save access
						</Button>
						<Button onClick={() => session.client.revoke("notes")}>
							Hide notes
						</Button>
					</div>
				</>
			)}
		</Session>
	);
}
