// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineResource } from "@hyecompany/vem-data";
import { DataProvider } from "@hyecompany/vem-data/react";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";
import { Button, Input } from "@hyecompany/vem-ui";
import { useSearch } from "@hyecompany/vem-ui/data";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@hyecompany/vem-ui/styles.css";

const tasks = defineResource<{ title: string; notes: string }, string>()({
	name: "tasks",
	fields: ["title", "notes"],
});
const values = [
	{ identity: "picnic", title: "Pack a picnic" },
	{ identity: "walk", title: "Plan a weekend walk" },
];
const acquisition = deferred<void>();
let reads = 0;
const runtime = createRuntime({
	resources: [
		{
			name: "tasks",
			access: () => "public",
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["title"],
					membership: true,
					run: async () => {
						reads++;
						await acquisition.promise;
						return {
							facts: values.map(({ identity, title }) => ({
								resource: "tasks",
								identity,
								presence: "present" as const,
								basis: ["public"],
								values: { title },
							})),
							memberships: [
								{
									resource: "tasks",
									identities: values.map(({ identity }) => identity),
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
});
Object.assign(window, {
	searchFixture: {
		reads: () => reads,
		finish: () => acquisition.resolve(),
	},
});
function Search() {
	const [enabled, setEnabled] = useState(false);
	const [acquire, setAcquire] = useState(false);
	const search = useSearch(
		(text) =>
			tasks.list({
				select: ["title"],
				where: {
					title: { contains: text, case: "insensitive", accents: "sensitive" },
				},
			}),
		{ enabled, acquire },
	);
	return (
		<main>
			<label htmlFor="search">Search tasks</label>
			<Input
				id="search"
				value={search.value}
				onChange={(event) => search.setValue(event.currentTarget.value)}
			/>
			<Button onClick={() => setEnabled(!enabled)}>
				{enabled ? "Disable search" : "Enable search"}
			</Button>
			<Button onClick={() => setAcquire(!acquire)}>
				{acquire ? "Observe only" : "Allow acquisition"}
			</Button>
			<Button onClick={() => search.setValue("")}>Clear search</Button>
			<Button
				onClick={() =>
					runtime.observe({
						facts: [
							{
								resource: "tasks",
								identity: "picnic",
								basis: ["public"],
								values: { title: "Pack lunch" },
							},
						],
					})
				}
			>
				Receive update
			</Button>
			<output aria-label="Fetching">{String(search.result.fetching)}</output>
			<ul aria-label="Search results">
				{search.result.rows.map((row) => (
					<li key={row.key}>{row.data.title}</li>
				))}
			</ul>
		</main>
	);
}
const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing");
const root = createRoot(element);
root.render(
	<StrictMode>
		<DataProvider client={runtime}>
			<Search />
		</DataProvider>
	</StrictMode>,
);
window.addEventListener(
	"pagehide",
	() => {
		root.unmount();
		runtime.close();
	},
	{ once: true },
);
