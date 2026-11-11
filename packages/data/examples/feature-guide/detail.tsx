// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region detail
import { useQuery } from "@hyecompany/vem-data/react";
import { type TaskRef, tasks } from "../task-board/contract.js";
import { ReadStatus } from "./status.js";

export function TaskDetail({ target }: { target: TaskRef }) {
	const result = useQuery(tasks.get(target, { select: ["title", "notes"] }));
	if (result.exists === false) return <p>This task no longer exists.</p>;
	const row = result.rows[0] ?? result.unresolved[0];
	return (
		<section>
			<ReadStatus result={result} />
			{result.rows.length === 0 && row && <p>Match not confirmed</p>}
			{row && (
				<>
					<h2>{row.data.title ?? "Title unavailable"}</h2>
					<p>{row.data.notes ?? "Notes unavailable"}</p>
				</>
			)}
		</section>
	);
}
// #endregion detail
