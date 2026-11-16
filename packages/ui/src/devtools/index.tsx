// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type {
	ClientInspector,
	ScenarioClient,
} from "@hyecompany/vem-data/devtools";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { Button } from "../button.js";
import { ActivitiesPanel } from "./activities-panel.js";
import { CommandsPanel } from "./commands-panel.js";
import { EditorsPanel } from "./editors-panel.js";
import { QueriesPanel } from "./queries-panel.js";

/** A development-only inspector. The application owns its clients, mode switches and lifetime. */
export interface DataInspectorProps {
	/** An existing inspector; mounting the view does not create data demand. */
	inspection: ClientInspector;
	/** Optional controls for an isolated scenario client matching the inspector. */
	scenarios?: ScenarioClient;
	/** Application-specific connection information or mode controls. */
	header?: ReactNode;
}

/** Embed inside a development tool host, such as TanStack Devtools. Import its stylesheet only in development. */
export function DataInspector({
	inspection,
	scenarios,
	header,
}: DataInspectorProps) {
	const [tab, setTab] = useState("Queries");
	const snapshot = useSyncExternalStore(
		inspection.subscribe,
		inspection.getSnapshot,
		inspection.getSnapshot,
	);
	const tabs = {
		Queries: snapshot.queries.length,
		Commands: snapshot.commands.length,
		Editors: snapshot.edits.length,
		Activities: snapshot.actions.length,
	};
	return (
		<section
			aria-label="Data tools"
			data-vem-ui=""
			data-vem-devtools="VEM_DEVTOOLS"
			className="vem-inspector"
		>
			<header className="vem-inspector-header">
				{header}
				<nav className="vem-inspector-actions" aria-label="Inspector sections">
					{Object.entries(tabs).map(([name, count]) => (
						<Button
							key={name}
							size="sm"
							variant={tab === name ? "default" : "ghost"}
							aria-pressed={tab === name}
							onClick={() => setTab(name)}
						>
							{name} ({count})
						</Button>
					))}
				</nav>
			</header>
			<div className="vem-inspector-content">
				{tab === "Queries" && (
					<QueriesPanel queries={snapshot.queries} scenarios={scenarios} />
				)}
				{tab === "Commands" && (
					<CommandsPanel commands={snapshot.commands} scenarios={scenarios} />
				)}
				{tab === "Editors" && (
					<EditorsPanel edits={snapshot.edits} scenarios={scenarios} />
				)}
				{tab === "Activities" && (
					<ActivitiesPanel actions={snapshot.actions} scenarios={scenarios} />
				)}
			</div>
		</section>
	);
}
