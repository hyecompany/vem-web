// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region status
import type { QueryResult } from "@hyecompany/vem-data";
import { queryView } from "@hyecompany/vem-data/react";

export function ReadStatus<T extends object, I>({
	result,
}: {
	result: QueryResult<T, I> & { retry(): Promise<QueryResult<T, I>> };
}) {
	const view = queryView(result);
	const message = {
		content: "",
		empty: "No matching tasks.",
		loading: "Loading tasks…",
		restricted: "Some task information is not available to you.",
		error: "Could not finish reading tasks.",
		incomplete: "The complete list is not known yet.",
	}[view];
	const incomplete =
		!result.confirmed.complete ||
		result.rows.some((row) => !row.complete) ||
		result.unresolved.length > 0;
	return (
		<div aria-live="polite">
			{message && <p>{message}</p>}
			{result.revalidating ? (
				<p>Checking for changes…</p>
			) : result.stale ? (
				<p>The last known result could not be confirmed.</p>
			) : result.fetching && view === "content" ? (
				<p>Reading missing information…</p>
			) : null}
			{result.unresolved.length > 0 && (
				<p>Some tasks still need information to match this filter.</p>
			)}
			{result.issues.map((issue) => (
				<p key={`${issue.kind}:${issue.scope}:${issue.message}`}>
					{issue.message}
				</p>
			))}
			{result.settled &&
				!result.empty &&
				(result.issues.some((issue) => issue.kind === "read") ||
					((incomplete || result.stale) && result.issues.length === 0)) && (
					<button type="button" onClick={() => void result.retry()}>
						Try again
					</button>
				)}
		</div>
	);
}
// #endregion status
