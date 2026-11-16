// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import type { DataClient, FeedbackClient } from "@hyecompany/vem-data";
import { DataProvider } from "@hyecompany/vem-data/react";
import { type ReactNode, useEffect, useState } from "react";

export function Session<
	T extends { client: DataClient; feedback?: FeedbackClient; close(): void },
>({
	create,
	children,
}: {
	create: () => T;
	children: (session: T) => ReactNode;
}) {
	const [session, setSession] = useState<T>();
	useEffect(() => {
		const value = create();
		setSession(value);
		return () => value.close();
	}, [create]);
	if (!session)
		return (
			<div className="lesson-placeholder">
				<span>Weekend plans</span>
				<p>Opening the task board…</p>
				<noscript>
					The walkthrough below describes what happens in this example.
				</noscript>
			</div>
		);
	return (
		<DataProvider client={session.client} feedback={session.feedback}>
			{children(session)}
		</DataProvider>
	);
}
