// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	QueryInspection,
	QueryScenario,
	ScenarioClient,
} from "@hyecompany/vem-data/devtools";
import { queryView } from "@hyecompany/vem-data/react";
import { useId, useState } from "react";
import { Button } from "../button.js";
import { Input } from "../input.js";
import { InspectorCard, ScenarioSelect } from "./controls.js";
import { FieldControl } from "./field-control.js";
import { QueryEvidence } from "./query-evidence.js";

const states: QueryScenario["state"][] = [
	"ready",
	"loading",
	"empty",
	"partial",
	"failed",
	"denied",
];

function QueryCard({
	query,
	scenarios,
}: {
	query: QueryInspection;
	scenarios?: ScenarioClient;
}) {
	const inputId = useId();
	const [missing, setMissing] = useState<string[]>([]);
	const [selectedState, setState] = useState<QueryScenario["state"]>("ready");
	const [delay, setDelay] = useState(0);
	const [message, setMessage] = useState("Simulated acquisition failure");
	const [values, setValues] = useState<Record<string, unknown>>({});
	const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
	const definition = scenarios?.resources.find(
		(resource) => resource.name === query.descriptor.resource,
	);
	const sample = definition?.example?.data as
		| Record<string, unknown>
		| undefined;
	const result = query.result;
	const fields = [
		...new Set([
			...query.descriptor.select,
			...Object.keys(query.descriptor.where ?? {}),
		]),
	];
	return (
		<InspectorCard
			data-query-resource={query.descriptor.resource}
			data-query-consumers={query.subscribers}
		>
			<h3 className="vem-inspector-heading">
				{query.descriptor.resource} ·{" "}
				{query.descriptor.mode === "one" ? "detail" : "list"}
			</h3>
			<p className="vem-inspector-identity">
				{JSON.stringify(query.descriptor.identity ?? query.descriptor.scope)}
			</p>
			<p>
				{query.subscribers} consumer{query.subscribers === 1 ? "" : "s"} ·{" "}
				{result?.rows.length ?? 0} row{result?.rows.length === 1 ? "" : "s"} ·{" "}
				{result?.unresolved.length ?? 0} unresolved
			</p>
			<p className="vem-inspector-small">
				{result ? (
					<>
						{queryView(result)} · {result.confirmed.knownCount} confirmed ·{" "}
						{result.confirmed.complete
							? "Complete membership"
							: "Incomplete membership"}
					</>
				) : (
					"No active consumer"
				)}
			</p>
			<p className="vem-inspector-small">
				Selected: {query.descriptor.select.join(", ")}
			</p>
			{scenarios && (
				<fieldset className="vem-inspector-controls">
					<legend className="vem-inspector-sr-only">
						{query.descriptor.resource} query scenario
					</legend>
					<ScenarioSelect
						label="Acquisition state"
						value={selectedState}
						choices={states}
						onValueChange={setState}
					/>
					{selectedState === "partial" && (
						<fieldset className="vem-inspector-tight-stack">
							<legend>Unavailable fields</legend>
							{fields.map((field) => (
								<label key={field} className="vem-inspector-inline">
									<input
										type="checkbox"
										checked={missing.includes(field)}
										onChange={(event) =>
											setMissing((current) =>
												event.target.checked
													? [...current, field]
													: current.filter((value) => value !== field),
											)
										}
									/>
									{field}
								</label>
							))}
							<p className="vem-inspector-hint">
								Missing filter values produce unresolved candidates; missing
								display values keep matching rows visible.
							</p>
						</fieldset>
					)}
					{selectedState === "loading" && (
						<label
							htmlFor={`${inputId}-delay`}
							className="vem-inspector-control-row"
						>
							Delay in milliseconds
							<Input
								id={`${inputId}-delay`}
								aria-label="Delay in milliseconds"
								className="vem-inspector-number"
								type="number"
								min="0"
								max="60000"
								value={delay}
								onChange={(event) => setDelay(Number(event.target.value))}
							/>
						</label>
					)}
					{(selectedState === "failed" || selectedState === "denied") && (
						<label
							htmlFor={`${inputId}-message`}
							className="vem-inspector-label"
						>
							Explanation
							<Input
								id={`${inputId}-message`}
								className="vem-inspector-input"
								value={message}
								onChange={(event) => setMessage(event.target.value)}
							/>
						</label>
					)}
					{sample && (
						<details>
							<summary className="vem-inspector-summary">Sample values</summary>
							<div className="vem-inspector-fields">
								{fields.map((field) => (
									<FieldControl
										key={field}
										name={field}
										value={
											Object.hasOwn(values, field)
												? values[field]
												: sample[field]
										}
										description={definition?.controls?.[field]}
										onChange={(value) =>
											setValues((current) => ({ ...current, [field]: value }))
										}
										onValidityChange={(valid) =>
											setInvalid((current) => {
												const next = new Set(current);
												if (valid) next.delete(field);
												else next.add(field);
												return next;
											})
										}
									/>
								))}
							</div>
						</details>
					)}
					<Button
						size="sm"
						disabled={
							invalid.size > 0 ||
							(selectedState === "loading" &&
								(!Number.isFinite(delay) || delay < 0 || delay > 60000))
						}
						onClick={() =>
							scenarios?.setQuery(query.id, {
								state: selectedState,
								missing,
								message,
								values,
								delayMs:
									selectedState === "loading" ? delay || undefined : undefined,
							})
						}
					>
						Apply query scenario
					</Button>
				</fieldset>
			)}
			<details>
				<summary className="vem-inspector-summary">
					How reads are chosen
				</summary>
				<p className="vem-inspector-evidence-hint">
					The owner combines missing requirements across consumers. By default,
					it prefers bounded reads, avoids extra records, then favors fewer
					requests and narrower representations. A backend cost model can
					provide a different comparison.
				</p>
				<p className="vem-inspector-evidence-hint">
					Complete inventories establish a count or, with unresolved filter
					candidates, a range. Partial inventories leave the total unknown.
					Stale inventories provide historical estimates, not current
					guarantees.
				</p>
				<p className="vem-inspector-evidence-hint">
					This inspector shows consumer demand, not the owner's source-selection
					trace.
				</p>
			</details>
			<QueryEvidence result={result} />
			<details>
				<summary className="vem-inspector-summary">Result details</summary>
				<pre className="vem-inspector-details">
					{JSON.stringify(result, null, 2)}
				</pre>
			</details>
		</InspectorCard>
	);
}

export function QueriesPanel({
	queries,
	scenarios,
}: {
	queries: readonly QueryInspection[];
	scenarios?: ScenarioClient;
}) {
	return (
		<div className="vem-inspector-stack">
			{queries.length ? (
				queries.map((query) => (
					<QueryCard key={query.id} query={query} scenarios={scenarios} />
				))
			) : (
				<p>Open a screen to discover its queries.</p>
			)}
		</div>
	);
}
