// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region list
import { useQuery } from "@hyecompany/vem-data/react";
import { useState } from "react";
import { tasks } from "../task-board/contract.js";
import { ReadStatus } from "./status.js";

export function TaskList() {
	const [openOnly, setOpenOnly] = useState(false);
	const result = useQuery(
		tasks.list({
			select: ["title", "status"],
			where: openOnly ? { status: "open" } : undefined,
		}),
	);
	return (
		<section>
			<label>
				<input
					type="checkbox"
					checked={openOnly}
					onChange={(event) => setOpenOnly(event.target.checked)}
				/>
				To do only
			</label>
			<ReadStatus result={result} />
			<ul>
				{result.rows.map((row) => (
					<li key={row.key}>
						{row.data.title ?? "Title unavailable"} ·{" "}
						{row.data.status ?? "Status unavailable"}
					</li>
				))}
			</ul>
			{result.unresolved.length > 0 && (
				<section aria-label="Match not confirmed">
					<h3>Match not confirmed</h3>
					<ul>
						{result.unresolved.map((row) => (
							<li key={row.key}>
								{row.data.title ?? "Title unavailable"} ·{" "}
								{row.data.status ?? "Status unavailable"}
							</li>
						))}
					</ul>
				</section>
			)}
		</section>
	);
}
// #endregion list
