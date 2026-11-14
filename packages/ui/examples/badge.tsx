// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Badge } from "@hyecompany/vem-ui";

export function BadgeExample() {
	return (
		<div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
			<Badge variant="default">Saved</Badge>
			<Badge variant="outline">Unconfirmed</Badge>
			<Badge variant="destructive">Needs attention</Badge>
		</div>
	);
}
// #endregion example
