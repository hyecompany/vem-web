// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	ActionHandle,
	ActionOutcome,
	Availability,
	EditField,
} from "@hyecompany/vem-data";
import type { ChangeEvent } from "react";

export interface CommandBinding<O extends ActionOutcome = ActionOutcome> {
	availability: Availability;
	canRun: boolean;
	run(): ActionHandle<O>;
}
/** Adapt admission to a native button. The caller owns progress presentation; this never retries an action. */
export function bindCommand<O extends ActionOutcome>(
	command: CommandBinding<O>,
) {
	return {
		disabled: !command.canRun,
		title: command.availability.reason,
		onClick: () => {
			if (command.canRun) command.run();
		},
	};
}
/** Bind a managed readable text field without retaining an independent copy of protected input. */
export function bindText(field: EditField<string | null | undefined>) {
	return {
		value: field.state === "readable" ? (field.value ?? "") : "",
		disabled: !field.canEdit,
		onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			if (field.state === "readable" && field.canEdit)
				field.setValue(event.currentTarget.value);
		},
	};
}
