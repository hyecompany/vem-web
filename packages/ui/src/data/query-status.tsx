// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { QueryResult } from "@hyecompany/vem-data";
import type { ReactNode } from "react";
import { Button } from "../button.js";

export interface QueryStatusProps<
	T extends object = Record<string, unknown>,
	I = unknown,
> {
	result: QueryResult<T, I> & { retry?: () => Promise<unknown> };
	empty?: ReactNode;
	loading?: ReactNode;
	className?: string;
}
/** Complement the rows with acquisition status; permitted content remains the caller's responsibility to render. */
export function QueryStatus<T extends object, I>({
	result,
	empty = "No results.",
	loading = "Loading…",
	className,
}: QueryStatusProps<T, I>) {
	const content = result.rows.length > 0 || result.unresolved.length > 0;
	const issue = result.issues[0];
	const message =
		issue?.message ??
		(result.revalidating
			? "Updating…"
			: result.stale
				? "Waiting to update…"
				: result.empty
					? empty
					: !content && (result.fetching || !result.settled)
						? loading
						: !result.confirmed.complete ||
								result.unresolved.length > 0 ||
								result.rows.some((row) => !row.complete)
							? "Some information is not available yet."
							: undefined);
	if (!message) return null;
	return (
		<output className={className} data-vem-query-status="">
			<span>{message}</span>
			{issue && result.retry && !result.fetching && (
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						void result.retry?.();
					}}
				>
					Retry
				</Button>
			)}
		</output>
	);
}
