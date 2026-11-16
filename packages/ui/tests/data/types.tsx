// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineResource } from "@hyecompany/vem-data";
import { useSearch } from "@hyecompany/vem-ui/data";

const tasks = defineResource<{ title: string; notes: string }, string>()({
	name: "tasks",
	fields: ["title", "notes"],
});

export function SearchContract() {
	const search = useSearch(
		(text) =>
			tasks.list({
				select: ["title"],
				where: { title: { contains: text } },
			}),
		{ enabled: true, acquire: false },
	);
	const title: string | undefined = search.result.rows[0]?.data.title;
	void title;
	// @ts-expect-error Search results preserve the query's selected fields.
	search.result.rows[0]?.data.notes;
	// @ts-expect-error Search text is always a string.
	search.setValue(10);
	return null;
}
