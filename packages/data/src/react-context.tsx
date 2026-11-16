// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type FeedbackClient, hasFeedbackClient } from "./feedback-types.js";
import type { DataClient } from "./types.js";

const ClientContext = createContext<{
	client: DataClient;
	feedback?: FeedbackClient;
} | null>(null);
/** Install one client. Browser clients supply feedback automatically; alternate hosts may supply it explicitly. */
export function DataProvider({
	client,
	feedback,
	children,
}: {
	client: DataClient;
	feedback?: FeedbackClient;
	children?: ReactNode;
}) {
	const value = useMemo(
		() => ({
			client,
			feedback: feedback ?? (hasFeedbackClient(client) ? client : undefined),
		}),
		[client, feedback],
	);
	return (
		<ClientContext.Provider value={value}>{children}</ClientContext.Provider>
	);
}
function useClientContext() {
	const value = useContext(ClientContext);
	if (!value)
		throw new Error(
			"Install DataProvider at the application root before using Vem Data",
		);
	return value;
}
/** Return the installed consumer client. */
export function useDataClient(): DataClient {
	return useClientContext().client;
}
export function useFeedbackClient(): FeedbackClient | undefined {
	return useClientContext().feedback;
}
