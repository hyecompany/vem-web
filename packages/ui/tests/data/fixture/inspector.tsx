// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineResource } from "@hyecompany/vem-data";
import {
	createScenarioClient,
	defineScenarios,
	inspectClient,
} from "@hyecompany/vem-data/devtools";
import { DataProvider, queryView, useQuery } from "@hyecompany/vem-data/react";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { Button } from "@hyecompany/vem-ui";
import { QueryStatus } from "@hyecompany/vem-ui/data";
import { DataInspector } from "@hyecompany/vem-ui/devtools";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@hyecompany/vem-ui/styles.css";
import "@hyecompany/vem-ui/devtools/styles.css";

const tasks = defineResource<{ title: string; notes: string }, string>()({
	name: "tasks",
	fields: ["title", "notes"],
});
const values = { title: "Pack a picnic", notes: "Bring sandwiches" };
const live = new URLSearchParams(location.search).has("live");
let reads = 0;
const runtime = live
	? createRuntime({
			resources: [
				{
					name: "tasks",
					access: () => "public",
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["title", "notes"],
							membership: true,
							run: async () => {
								reads++;
								return {
									facts: [
										{
											resource: "tasks",
											identity: "picnic",
											presence: "present",
											basis: ["public"],
											values,
										},
									],
									memberships: [
										{
											resource: "tasks",
											identities: ["picnic"],
											complete: true,
											basis: ["public"],
										},
									],
								};
							},
						},
					],
				},
			],
		})
	: undefined;
const scenarios = runtime
	? undefined
	: createScenarioClient({
			resources: [
				defineScenarios(tasks, {
					example: { identity: "picnic", data: values },
				}),
			],
		});
const inspection = runtime ? inspectClient(runtime) : scenarios;
if (!inspection) throw new Error("Inspector fixture needs a client");

const activeInspection = inspection;
Object.assign(window, { inspectorFixture: { reads: () => reads } });
function Tasks() {
	const result = useQuery(tasks.list());
	return (
		<section aria-label="Task list">
			<h2>Tasks</h2>
			<output aria-label="Query state">{queryView(result)}</output>
			<QueryStatus result={result} />
			<ul>
				{result.rows.map((row) => (
					<li key={row.key}>
						<p>{row.data.title ?? "Title unavailable"}</p>
						<p>{row.data.notes ?? "Notes unavailable"}</p>
					</li>
				))}
			</ul>
		</section>
	);
}
function App() {
	const [showInspector, setShowInspector] = useState(false);
	const [showConsumer, setShowConsumer] = useState(true);
	return (
		<DataProvider client={activeInspection.client}>
			<main style={{ maxWidth: 960, margin: "24px auto", padding: 16 }}>
				<h1>Task inspector fixture</h1>
				<Button onClick={() => setShowInspector(!showInspector)}>
					{showInspector ? "Hide inspector" : "Show inspector"}
				</Button>
				<Button onClick={() => setShowConsumer(!showConsumer)}>
					{showConsumer ? "Hide tasks" : "Show tasks"}
				</Button>
				{runtime && (
					<Button
						onClick={() =>
							runtime.observe({
								facts: [
									{
										resource: "tasks",
										identity: "picnic",
										basis: ["public"],
										values: { title: "Plan a weekend walk" },
									},
								],
							})
						}
					>
						Receive task update
					</Button>
				)}
				{showConsumer && <Tasks />}
				{showInspector && (
					<DataInspector
						inspection={activeInspection}
						scenarios={scenarios}
						header={
							<p>{live ? "Live inspection" : "Isolated task scenarios"}</p>
						}
					/>
				)}
			</main>
		</DataProvider>
	);
}
const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing");
const root = createRoot(element);
root.render(
	<StrictMode>
		<App />
	</StrictMode>,
);
window.addEventListener(
	"pagehide",
	() => {
		root.unmount();
		activeInspection.close();
		runtime?.close();
	},
	{ once: true },
);
