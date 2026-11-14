// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Textarea } from "@hyecompany/vem-ui";
import { useId } from "react";

export function TextareaExample() {
	const id = useId();
	return (
		<label htmlFor={id}>
			Notes
			<Textarea
				id={id}
				name="notes"
				defaultValue="Meet by the lake at 10."
				rows={3}
			/>
		</label>
	);
}
// #endregion example
