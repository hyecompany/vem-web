// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { defineCommand, defineResource } from "@hyecompany/vem-data";
import { DataProvider, useQuery } from "@hyecompany/vem-data/react";
import { createTestClient } from "@hyecompany/vem-data/testing";
import {
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@hyecompany/vem-ui";
import { CommandButton, QueryStatus } from "@hyecompany/vem-ui/data";
import { useEffect, useState } from "react";
import { SwitchExample } from "../examples/switch";

const tasks = defineResource<{ title: string }, string>()({
	name: "tasks",
	fields: ["title"],
	commands: { complete: defineCommand() },
});
const query = tasks.list({ select: ["title"] });
function DataFeature() {
	const result = useQuery(query);
	return (
		<>
			<p>{result.rows[0]?.data.title}</p>
			<QueryStatus result={result} />
			<CommandButton command={tasks.commands.complete("walk")}>
				Complete task
			</CommandButton>
		</>
	);
}
export function Demo() {
	const [value, setValue] = useState<string | null>("Weekend"),
		[saved, setSaved] = useState(false);
	const [fixture, setFixture] = useState<ReturnType<typeof createTestClient>>();
	useEffect(() => {
		const current = createTestClient({
			queries: [
				{ query, rows: [{ identity: "walk", data: { title: "Plan a walk" } }] },
			],
			commands: [
				{
					command: tasks.commands.complete("walk"),
					outcome: { kind: "succeeded" },
				},
			],
		});
		setFixture(current);
		return () => current.close();
	}, []);
	return (
		<>
			<Button variant="default" onClick={() => setSaved(true)}>
				Save task
			</Button>
			<output>{saved ? "Saved" : "Ready"}</output>
			<SwitchExample />
			<Combobox
				items={["Weekend", "Work"]}
				value={value}
				onValueChange={setValue}
			>
				<ComboboxInput aria-label="Board" />
				<ComboboxContent>
					<ComboboxList>
						{(item: string) => (
							<ComboboxItem key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{fixture && (
				<DataProvider client={fixture.client}>
					<DataFeature />
				</DataProvider>
			)}
		</>
	);
}
