// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineResource } from "@hyecompany/vem-data";
import { inspectClient } from "@hyecompany/vem-data/devtools";
import {
	DataProvider,
	useQuery,
	useReadStatus,
} from "@hyecompany/vem-data/react";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const tasks = defineResource<{ title: string }, string>()({
	name: "tasks",
	fields: ["title"],
	defaultSelect: ["title"],
});
let reads = 0;
let hold: Promise<void> | undefined;
let release: (() => void) | undefined;
const runtime = createRuntime({
	access: [{ scope: "read", state: "allowed" }],
	resources: [
		{
			name: "tasks",
			access: () => "read",
			sources: [
				{
					key: "list",
					mode: "list",
					fields: ["title"],
					membership: true,
					async run() {
						reads++;
						await hold;
						return {
							facts: [
								{
									resource: "tasks",
									identity: "a",
									values: { title: "Protected task" },
									presence: "present",
									basis: ["read"],
								},
							],
							memberships: [
								{
									resource: "tasks",
									identities: ["a"],
									complete: true,
									basis: ["read"],
								},
							],
						};
					},
				},
			],
		},
	],
});
const inspection = inspectClient(runtime);
const harness = {
	frames: [] as {
		id: string;
		enabled: boolean;
		rows: number;
		fetching: boolean;
		complete: boolean;
	}[],
	stats: () => ({
		reads,
		subscribers: inspection
			.getSnapshot()
			.queries.reduce((sum, query) => sum + query.subscribers, 0),
	}),
	revoke: () => runtime.revoke("read"),
	grant: () =>
		runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] }),
	pause: () => {
		hold = new Promise<void>((resolve) => {
			release = resolve;
		});
	},
	resume: () => {
		release?.();
		hold = undefined;
	},
};
declare global {
	interface Window {
		fixture: typeof harness;
	}
}
window.fixture = harness;

function Consumer({
	id,
	enabled,
	acquire = true,
}: {
	id: string;
	enabled: boolean;
	acquire?: boolean;
}) {
	const result = useQuery(tasks.list(), { enabled, acquire });
	useLayoutEffect(() => {
		harness.frames.push({
			id,
			enabled,
			rows: result.rows.length,
			fetching: result.fetching,
			complete: result.confirmed.complete,
		});
	}, [id, enabled, result]);
	return (
		<section>
			<output
				data-testid={id}
				data-enabled={enabled}
				data-fetching={result.fetching}
				data-settled={result.settled}
			>
				{result.rows.map((row) => row.data.title).join(",")}
			</output>
			<button type="button" onClick={() => void result.retry()}>
				Retry {id}
			</button>
		</section>
	);
}
function Status({ enabled }: { enabled: boolean }) {
	const status = useReadStatus(tasks.list(), { enabled });
	return (
		<output data-testid="read-status">
			{status.pending ? "pending" : "idle"}
		</output>
	);
}
function App() {
	const [first, setFirst] = useState(false);
	const [second, setSecond] = useState(false);
	const [passive, setPassive] = useState(false);
	const [observe, setObserve] = useState(false);
	const [acquire, setAcquire] = useState(false);
	return (
		<DataProvider client={inspection.client}>
			<button type="button" onClick={() => setFirst(!first)}>
				Toggle first
			</button>
			<button type="button" onClick={() => setSecond(!second)}>
				Toggle second
			</button>
			<button type="button" onClick={() => setPassive(!passive)}>
				Toggle passive
			</button>
			<button type="button" onClick={() => setObserve(!observe)}>
				Toggle observer
			</button>
			<button type="button" onClick={() => setAcquire(!acquire)}>
				Toggle acquisition
			</button>
			<Consumer id="passive" enabled={passive} acquire={acquire} />
			<Status enabled={observe} />
			<Consumer id="first" enabled={first} />
			<Consumer id="second" enabled={second} />
		</DataProvider>
	);
}
const container = document.getElementById("root");
if (!container) throw new Error("Missing test container");
createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
