// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region compatibility
import { protocolVersion } from "@hyecompany/vem-data/client";
import { persistenceSchemaVersion } from "@hyecompany/vem-data/runtime";
export const compatibility = {
	protocol: protocolVersion,
	schema: persistenceSchemaVersion,
	definitions: 1,
	build: "task-board-1",
};

// #endregion compatibility

// #region connect
import { connectSharedWorker } from "@hyecompany/vem-data/client";
import { taskRead } from "../task-board/read.js";

export function connectTasks(ownerModule: URL) {
	return connectSharedWorker(ownerModule, compatibility, {
		readDefinitions: [taskRead],
	});
}

// #endregion connect

// #region provider
import type { BrowserClient } from "@hyecompany/vem-data/client";
import { DataProvider } from "@hyecompany/vem-data/react";
import { type ReactNode, useSyncExternalStore } from "react";

export function TaskProvider({
	client,
	children,
}: {
	client: BrowserClient;
	children: ReactNode;
}) {
	const connection = useSyncExternalStore(
		client.subscribe,
		client.connectionSnapshot,
	);
	if (connection.phase === "connecting") return <p>Connecting…</p>;
	if (connection.phase !== "ready") {
		return (
			<p role="alert">{connection.error ?? "Reconnect to the task service."}</p>
		);
	}
	return <DataProvider client={client}>{children}</DataProvider>;
}
// #endregion provider

// #region upgrade
export async function updateApp(client: BrowserClient) {
	const update = await client.upgrade();
	if (update.ready) location.reload();
	return update.reason;
}
// #endregion upgrade
