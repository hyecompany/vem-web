// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Switch } from "@hyecompany/vem-ui";
import { useId, useState } from "react";

export function SwitchExample() {
	const id = useId();
	const [enabled, setEnabled] = useState(false);
	return (
		<div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
			<Switch id={id} checked={enabled} onCheckedChange={setEnabled} />
			<label htmlFor={id}>Show completed tasks</label>
		</div>
	);
}
// #endregion example
