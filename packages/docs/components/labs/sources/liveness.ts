// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineResource } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";

export const liveTask = defineResource<
	{ id: string; title: string; temperature: number },
	string
>()({ name: "weekend-task", fields: ["id", "title", "temperature"] });
const channel = { channel: "task-events", scope: { board: "weekend" } };
interface State {
	phase: "connected" | "offline" | "changed" | "reconnected";
	reads: readonly {
		id: number;
		fields: readonly string[];
		state: "reading" | "finished" | "failed";
	}[];
	service: { id: string; title: string; temperature: number };
}
export function createLiveness() {
	let state: State = {
		phase: "connected",
		reads: [],
		service: { id: "walk", title: "Plan a weekend walk", temperature: 18 },
	};
	const listeners = new Set<() => void>();
	let reply: ((error?: Error) => void) | undefined;
	const publish = () => {
		for (const listener of listeners) listener();
	};
	const client = createRuntime({
		resources: [
			{
				name: "weekend-task",
				access: "public",
				sources: [
					{
						key: "task-fields",
						mode: "one",
						fields: ["id", "title", "temperature"],
						select: true,
						async run(request, context) {
							const id = state.reads.length + 1;
							state = {
								...state,
								reads: [
									...state.reads,
									{ id, fields: request.fields, state: "reading" },
								],
							};
							publish();
							try {
								if (state.phase === "offline" || state.phase === "changed")
									throw new Error("The task service is offline.");
								if (state.phase === "reconnected") {
									const wait = new Promise<void>((resolve, reject) => {
										reply = (error) => (error ? reject(error) : resolve());
									});
									const abort = () =>
										reply?.(new Error("The read was canceled."));
									context.signal.addEventListener("abort", abort, {
										once: true,
									});
									if (context.signal.aborted) abort();
									try {
										await wait;
									} finally {
										context.signal.removeEventListener("abort", abort);
										reply = undefined;
									}
								}
							} catch (error) {
								state = {
									...state,
									reads: state.reads.map((read) =>
										read.id === id ? { ...read, state: "failed" } : read,
									),
								};
								publish();
								throw error;
							}
							state = {
								...state,
								reads: state.reads.map((read) =>
									read.id === id ? { ...read, state: "finished" } : read,
								),
							};
							publish();
							return {
								facts: [
									{
										resource: "weekend-task",
										identity: "walk",
										presence: "present",
										basis: ["public"],
										values: Object.fromEntries(
											request.fields.map((field) => [
												field,
												state.service[field as keyof State["service"]],
											]),
										),
										fieldLiveness: {
											id: "immutable",
											title: channel,
											temperature: "snapshot",
										},
									},
								],
							};
						},
					},
				],
			},
		],
	});
	client.setContinuity(channel, "live");
	return {
		client,
		snapshot: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		next() {
			if (state.phase === "connected") {
				state = { ...state, phase: "offline" };
				client.setContinuity(channel, "interrupted");
			} else if (state.phase === "offline") {
				state = {
					...state,
					phase: "changed",
					service: {
						...state.service,
						title: "Walk by the lake",
						temperature: 21,
					},
				};
			} else if (state.phase === "changed") {
				state = { ...state, phase: "reconnected" };
				client.setContinuity(channel, "live");
			}
			publish();
		},
		reply(failed = false) {
			reply?.(
				failed ? new Error("The title could not be checked.") : undefined,
			);
		},
		close() {
			client.close();
			listeners.clear();
		},
	};
}
