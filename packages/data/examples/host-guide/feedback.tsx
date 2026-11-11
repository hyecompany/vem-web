// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region inline
import type { BrowserClient } from "@hyecompany/vem-data/client";
import { useQuery } from "@hyecompany/vem-data/react";
import { useEffect } from "react";
import { tasks } from "../task-board/contract.js";

export function TaskPageProgress({ client }: { client: BrowserClient }) {
	const result = useQuery(tasks.list({ select: ["title", "status"] }));
	useEffect(
		() =>
			client.claimQueryFeedback(tasks.list({ select: ["title", "status"] })),
		[client],
	);
	return (
		<div aria-live="polite">
			{result.activities.map((action) => (
				<p key={action.id}>
					{action.outcome?.kind ?? action.progress?.message ?? "Working…"}
				</p>
			))}
		</div>
	);
}

// #endregion inline

// #region feedback
import { useActivities } from "@hyecompany/vem-data/react";
import { useSyncExternalStore } from "react";

export function ActionNotices({ client }: { client: BrowserClient }) {
	const ids = useSyncExternalStore(client.subscribe, client.feedback);
	const activities = useActivities();
	return (
		<aside aria-label="Activity" aria-live="polite">
			{activities
				.filter((action) => ids.includes(action.id))
				.map((action) => (
					<div key={action.id}>
						<span>
							{action.outcome?.kind ?? action.progress?.message ?? "Working…"}
						</span>
						<button
							type="button"
							onClick={() => client.acknowledgeFeedback(action.id, action)}
						>
							Dismiss
						</button>
					</div>
				))}
		</aside>
	);
}
// #endregion feedback
