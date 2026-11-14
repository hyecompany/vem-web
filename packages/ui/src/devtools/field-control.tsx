// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { FieldControl as FieldDescription } from "@hyecompany/vem-data/devtools";
import { useId, useState } from "react";
import { Input } from "../input.js";
import { Textarea } from "../textarea.js";

function StructuredValue({
	id,
	value,
	onChange,
	onValidityChange,
}: {
	id: string;
	value: unknown;
	onChange(value: unknown): void;
	onValidityChange(valid: boolean): void;
}) {
	const [text, setText] = useState(JSON.stringify(value ?? null, null, 2));
	const [error, setError] = useState<string>();
	return (
		<>
			<Textarea
				id={id}
				className="vem-inspector-json"
				value={text}
				aria-invalid={!!error}
				aria-describedby={error ? `${id}-error` : undefined}
				onChange={(event) => {
					setText(event.target.value);
					try {
						const parsed = JSON.parse(event.target.value);
						setError(undefined);
						onValidityChange(true);
						onChange(parsed);
					} catch {
						setError("Enter valid JSON before applying this value.");
						onValidityChange(false);
					}
				}}
			/>
			{error && (
				<p id={`${id}-error`} className="vem-inspector-error">
					{error}
				</p>
			)}
		</>
	);
}

export function FieldControl({
	name,
	value,
	description,
	onChange,
	onValidityChange,
}: {
	name: string;
	value: unknown;
	description?: FieldDescription;
	onChange(value: unknown): void;
	onValidityChange(valid: boolean): void;
}) {
	const id = useId();
	const kind =
		description?.kind ?? (Array.isArray(value) ? "array" : typeof value);
	const choices = description?.choices;
	return (
		<div className="vem-inspector-tight-stack">
			<label htmlFor={id} className="vem-inspector-field-label">
				{description?.label ?? name}
			</label>
			{choices ? (
				<select
					id={id}
					className="vem-inspector-select-wide"
					value={choices.findIndex(
						(choice) => JSON.stringify(choice) === JSON.stringify(value),
					)}
					onChange={(event) => onChange(choices[Number(event.target.value)])}
				>
					<option value="-1" disabled>
						Choose a value
					</option>
					{choices.map((choice, index) => (
						<option key={JSON.stringify(choice)} value={index}>
							{typeof choice === "string" ? choice : JSON.stringify(choice)}
						</option>
					))}
				</select>
			) : kind === "boolean" ? (
				<input
					id={id}
					type="checkbox"
					checked={value === true}
					onChange={(event) => onChange(event.target.checked)}
				/>
			) : kind === "object" || kind === "array" ? (
				<StructuredValue
					id={id}
					value={value}
					onChange={onChange}
					onValidityChange={onValidityChange}
				/>
			) : (
				<Input
					id={id}
					className="vem-inspector-full"
					type={kind === "number" ? "number" : "text"}
					value={
						typeof value === "string" || typeof value === "number" ? value : ""
					}
					onChange={(event) =>
						onChange(
							kind === "number"
								? Number(event.target.value)
								: event.target.value,
						)
					}
				/>
			)}
		</div>
	);
}
