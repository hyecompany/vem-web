// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Input } from "@hyecompany/vem-ui";
import { QueryStatus, useSearch } from "@hyecompany/vem-ui/data";
import { useId } from "react";
import { tasks } from "./data-model.js";

export function TaskSearch() {
	const id = useId();
	const search = useSearch((text) =>
		tasks.list({
			select: ["title"],
			where: { title: { contains: text, case: "insensitive" } },
		}),
	);
	return (
		<section aria-label="Find a task">
			<label htmlFor={id}>Search tasks</label>
			<Input
				id={id}
				value={search.value}
				onChange={(event) => search.setValue(event.currentTarget.value)}
			/>
			<ul>
				{search.result.rows.map((row) => (
					<li key={row.key}>{row.data.title ?? "Title unavailable"}</li>
				))}
			</ul>
			<QueryStatus result={search.result} empty="No matching tasks." />
		</section>
	);
}
// #endregion example
