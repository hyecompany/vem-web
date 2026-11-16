// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { useQuery } from "@hyecompany/vem-data/react";
import { QueryStatus } from "@hyecompany/vem-ui/data";
import { tasks } from "./data-model.js";

export function TaskNames() {
	const result = useQuery(tasks.list({ select: ["title"] }));
	return (
		<>
			<ul>
				{result.rows.map((row) => (
					<li key={row.key}>{row.data.title ?? "Title unavailable"}</li>
				))}
			</ul>
			<QueryStatus result={result} empty="No tasks yet." />
		</>
	);
}
// #endregion example
