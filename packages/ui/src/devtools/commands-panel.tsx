// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionOutcome, Availability } from "@hyecompany/vem-data";
import type {
	CommandInspection,
	ScenarioClient,
} from "@hyecompany/vem-data/devtools";
import { useState } from "react";
import { Button } from "../button.js";
import { InspectorCard, ScenarioSelect } from "./controls.js";

import { outcomeKinds, scenarioOutcome } from "./outcomes.js";

function CommandCard({
	command,
	scenarios,
}: {
	command: CommandInspection;
	scenarios?: ScenarioClient;
}) {
	const [availability, setAvailability] =
		useState<Availability["state"]>("available");
	const [outcome, setOutcome] = useState<ActionOutcome["kind"]>("succeeded");
	const [pending, setPending] = useState(false);
	const input = command.descriptor.input;
	const summary =
		scenarios && input && typeof input === "object"
			? Object.entries(input)
					.filter(([, value]) =>
						["string", "number", "boolean"].includes(typeof value),
					)
					.map(([name, value]) => `${name}: ${String(value)}`)
					.join(" · ")
			: undefined;
	return (
		<InspectorCard data-command-name={command.descriptor.name}>
			<h3 className="vem-inspector-heading">
				{command.descriptor.resource} · {command.descriptor.name}
			</h3>
			{summary && <p className="vem-inspector-small">{summary}</p>}
			<p className="vem-inspector-identity">
				{JSON.stringify(command.descriptor.target)}
			</p>
			<p>
				{command.availability.state}
				{command.availability.reason ? `: ${command.availability.reason}` : ""}
			</p>
			{scenarios && (
				<fieldset className="vem-inspector-controls">
					<legend className="vem-inspector-sr-only">Command scenario</legend>
					<ScenarioSelect
						label="Admission"
						value={availability}
						choices={
							[
								"available",
								"unknown",
								"denied",
								"unsupported",
								"blocked",
							] as const
						}
						onValueChange={setAvailability}
					/>
					<ScenarioSelect
						label="Outcome"
						value={outcome}
						choices={outcomeKinds}
						onValueChange={setOutcome}
					/>
					<label className="vem-inspector-inline">
						<input
							type="checkbox"
							checked={pending}
							onChange={(event) => setPending(event.target.checked)}
						/>
						Hold for manual progress and completion
					</label>
					<Button
						size="sm"
						onClick={() =>
							scenarios?.setCommand(command.id, {
								availability: {
									state: availability,
									reason:
										availability === "available"
											? undefined
											: `Simulated ${availability} admission`,
								},
								outcome: scenarioOutcome(outcome),
								pending,
							})
						}
					>
						Apply command scenario
					</Button>
					<p className="vem-inspector-hint">
						Run the command from the screen. Use Activities to advance held
						work.
					</p>
				</fieldset>
			)}
			{scenarios && (
				<details>
					<summary className="vem-inspector-summary">Command input</summary>
					<pre className="vem-inspector-details">
						{JSON.stringify(command.descriptor.input, null, 2)}
					</pre>
				</details>
			)}
		</InspectorCard>
	);
}

export function CommandsPanel({
	commands,
	scenarios,
}: {
	commands: readonly CommandInspection[];
	scenarios?: ScenarioClient;
}) {
	return (
		<div className="vem-inspector-stack">
			{commands.length ? (
				commands.map((command) => (
					<CommandCard
						key={command.id}
						command={command}
						scenarios={scenarios}
					/>
				))
			) : (
				<p>Open a screen with actions to discover its commands.</p>
			)}
		</div>
	);
}
