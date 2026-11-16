// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Button } from "@hyecompany/vem-ui";
import { useState } from "react";

export function ButtonExample() {
	const [saved, setSaved] = useState(false);
	return (
		<div
			style={{
				display: "flex",
				gap: "0.75rem",
				alignItems: "center",
				flexWrap: "wrap",
			}}
		>
			<Button variant="default" onClick={() => setSaved(true)}>
				Save task
			</Button>
			<Button variant="ghost" onClick={() => setSaved(false)}>
				Undo
			</Button>
			<output aria-live="polite">
				{saved ? "Task saved" : "Ready to save"}
			</output>
		</div>
	);
}
// #endregion example
