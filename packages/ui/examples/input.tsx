// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Input } from "@hyecompany/vem-ui";
import { useId } from "react";

export function InputExample() {
	const id = useId();
	return (
		<label htmlFor={id}>
			Task title
			<Input id={id} name="title" defaultValue="Plan a weekend walk" />
		</label>
	);
}
// #endregion example
