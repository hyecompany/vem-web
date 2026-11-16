// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ComponentProps } from "react";

export function InspectorCard(props: ComponentProps<"article">) {
	return <article {...props} className="vem-inspector-card" />;
}

export function ScenarioSelect<const T extends string>({
	label,
	value,
	choices,
	onValueChange,
}: {
	label: string;
	value: T;
	choices: readonly T[];
	onValueChange: (value: NoInfer<T>) => void;
}) {
	return (
		<label className="vem-inspector-control-row">
			{label}
			<select
				aria-label={label}
				className="vem-inspector-select"
				value={value}
				onChange={(event) => {
					const choice = choices.find((item) => item === event.target.value);
					if (choice !== undefined) onValueChange(choice);
				}}
			>
				{choices.map((choice) => (
					<option key={choice}>{choice}</option>
				))}
			</select>
		</label>
	);
}
