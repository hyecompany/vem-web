// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { feedbackCandidates } from "./feedback-policy.js";
import {
	type AccessSnapshot,
	type Compatibility,
	feedbackStage,
	type Publication,
	protocolVersion,
} from "./protocol.js";
import { emptyReadModel, readModelDelta } from "./read-model/publication.js";
import type {
	QueryAcquisitionState,
	ReadModelSnapshot,
} from "./read-model/types.js";
import type {
	ActionHandle,
	CommandDescriptor,
	DataClient,
	EditDescriptor,
	PreparedEdit,
	QueryDescriptor,
	QueryHandle,
	QueryResult,
	ReadStatus,
	ReadStatusHandle,
	Values,
} from "./types.js";
import { equal } from "./values.js";

export interface OwnerClient extends DataClient {
	/** Restoration completes before the initial snapshot admits queued consumer demand. */
	readonly ready?: Promise<void>;
	accessSnapshot(): AccessSnapshot;
	readModelSnapshot(): ReadModelSnapshot;
	peekQuery(query: QueryDescriptor): QueryResult | undefined;
	flush?(): Promise<void>;
}
export interface SharedHostOptions {
	compatibility: Compatibility;
	lockName: string;
	locks: LockManager;
	create(): Promise<{ client: OwnerClient; dispose(): void | Promise<void> }>;
	onClosed?(): void;
	maxInactiveQueries?: number;
}
type Connection = {
	port: MessagePort;
	id: string;
	hello: boolean;
	revision: number;
	queries: Map<string, QueryHandle>;
	readStatuses: Map<string, ReadStatusHandle>;
	previousReadStatuses: Map<string, ReadStatus>;
	readModel: ReadModelSnapshot;
	accessKey: string;
	previous: Map<string, QueryAcquisitionState>;
	passiveQueries: Map<string, QueryDescriptor>;
	forgottenQueries: Set<string>;
	commands: Map<string, CommandDescriptor>;
	feedback: Map<string, readonly string[]>;
	feedbackQueries: Map<string, string>;
	stop: Map<string, () => void>;
	lifetime: AbortController;
	reads: Map<string, AbortController>;
};
type Message = {
	type: string;
	id: string;
	requestId?: string;
	nextId: string;
	compatibility: Compatibility;
	liveness: boolean;
	query: QueryDescriptor;
	acquire?: boolean;
	queryId?: string;
	command: CommandDescriptor;
	retry?: boolean;
	descriptor: EditDescriptor;
	prepared: PreparedEdit;
	values: Values;
	scope: string;
	claim: string;
	ids: readonly string[];
	stage: string;
};

/** Acquire the version-independent owner lock and create a port attachment function. Compatibility checks prevent incoherent consumers; ownership is never stolen on a timer. */
export function createSharedHost(
	options: SharedHostOptions,
): Promise<(port: MessagePort) => void> {
	if (options.compatibility.protocol !== protocolVersion)
		return Promise.reject(
			new Error(`This owner requires protocol ${protocolVersion}`),
		);
	const maxInactiveQueries = options.maxInactiveQueries ?? 100;
	if (!Number.isInteger(maxInactiveQueries) || maxInactiveQueries < 0)
		return Promise.reject(
			new RangeError("maxInactiveQueries must be a nonnegative integer"),
		);
	return new Promise((resolve, reject) => {
		void options.locks
			.request(options.lockName, async () => {
				const owner = await options.create();
				const client = owner.client;
				try {
					await client.ready;
				} catch (error) {
					try {
						await owner.dispose();
					} finally {
						client.close();
					}
					throw error;
				}
				const epoch = crypto.randomUUID();
				const connections = new Set<Connection>();
				const handles = new Map<string, ActionHandle>();
				const acknowledgements = new Map<string, string>();
				const terminal = new Set<string>();
				const remember = (handle: ActionHandle) => {
					handles.set(handle.id, handle);
					void handle.result.then((outcome) => {
						if (
							!client.listActivities().some((action) => action.id === handle.id)
						)
							for (const connection of connections)
								if (connection.hello)
									connection.port.postMessage({
										type: "action-withdrawn",
										id: handle.id,
									});
						if (outcome.kind !== "unknown") {
							terminal.add(handle.id);
							publishAll();
						}
					});
				};
				let release!: () => void;
				const lifetime = new Promise<void>((done) => {
					release = done;
				});
				let queued = false;
				let draining = false;
				let retiring: Connection | undefined;
				const publish = (connection: Connection, reset = false) => {
					if (!connection.hello) return;
					const queries: Publication["queries"][number][] = [];
					const access = client.accessSnapshot();
					const accessKey = JSON.stringify([
						access.epoch,
						access.contextId,
						access.revision,
					]);
					reset ||= accessKey !== connection.accessKey;
					connection.accessKey = accessKey;
					const readModel = client.readModelSnapshot();
					const values = new Map(
						[...connection.queries].map(([id, handle]) => [
							id,
							handle.getSnapshot(),
						]),
					);
					for (const [id, query] of connection.passiveQueries) {
						const value = client.peekQuery(query);
						if (value) values.set(id, value);
						else {
							connection.passiveQueries.delete(id);
							connection.previous.delete(id);
							connection.forgottenQueries.add(id);
						}
					}
					for (const [id, value] of values) {
						const status = {
							revalidating: value.revalidating,
							fetching: value.fetching,
							settled: value.settled,
							issues: value.issues,
						};
						if (!reset && equal(connection.previous.get(id), status)) continue;
						queries.push({ id, status });
						connection.previous.set(id, status);
					}
					const readStatuses: Publication["readStatuses"][number][] = [];
					for (const [id, handle] of connection.readStatuses) {
						const status = handle.getSnapshot();
						if (
							!reset &&
							equal(connection.previousReadStatuses.get(id), status)
						)
							continue;
						readStatuses.push({ id, status });
						connection.previousReadStatuses.set(id, status);
					}
					const activities = client.listActivities();
					const peers = [...connections].filter((peer) => peer.hello);
					const fallback = peers[0]?.id;
					const inline = new Set([...connection.feedback.values()].flat());
					for (const queryId of connection.feedbackQueries.values())
						for (const action of connection.queries.get(queryId)?.getSnapshot()
							.activities ?? [])
							inline.add(action.id);
					const feedback = feedbackCandidates(
						activities,
						inline,
						acknowledgements,
						(action) => {
							const destination = peers.some(
								(peer) => peer.id === action.origin,
							)
								? action.origin
								: fallback;
							return destination === connection.id;
						},
					);
					const publication: Publication = {
						type: "publish",
						epoch,
						base: connection.revision,
						revision: ++connection.revision,
						reset,
						queries,
						readStatuses,
						forgottenQueries: [...connection.forgottenQueries],
						readModel: readModelDelta(connection.readModel, readModel, reset),
						availability: [...connection.commands].map(([id, command]) => ({
							id,
							value: client.availability(command),
						})),
						activities,
						access,
						feedback,
					};
					connection.port.postMessage(publication);
					connection.readModel = readModel;
					connection.forgottenQueries.clear();
				};
				const publishAll = () => {
					if (queued) return;
					queued = true;
					queueMicrotask(() => {
						queued = false;
						const activities = client.listActivities();
						const retained = new Set(activities.map((action) => action.id));
						for (const action of activities)
							if (
								action.phase === "settled" &&
								action.outcome &&
								action.outcome.kind !== "unknown"
							)
								terminal.add(action.id);
						for (const id of terminal)
							if (!retained.has(id)) {
								handles.delete(id);
								acknowledgements.delete(id);
								terminal.delete(id);
							}
						for (const connection of connections) publish(connection);
					});
				};
				const unsubscribe = client.subscribe(publishAll);
				const remove = (connection: Connection) => {
					if (!connections.delete(connection)) return;
					if (retiring === connection) release();
					connection.lifetime.abort();
					for (const read of connection.reads.values()) read.abort();
					connection.reads.clear();
					for (const stop of connection.stop.values()) stop();
					for (const handle of connection.queries.values()) handle.dispose();
					for (const handle of connection.readStatuses.values())
						handle.dispose();
					connection.port.close();
					publishAll();
				};
				const attach = (port: MessagePort) => {
					const connection: Connection = {
						port,
						id: "",
						hello: false,
						revision: 0,
						queries: new Map(),
						readStatuses: new Map(),
						previousReadStatuses: new Map(),
						readModel: emptyReadModel(),
						accessKey: "",
						previous: new Map(),
						passiveQueries: new Map(),
						forgottenQueries: new Set(),
						commands: new Map(),
						feedback: new Map(),
						feedbackQueries: new Map(),
						stop: new Map(),
						lifetime: new AbortController(),
						reads: new Map(),
					};
					connections.add(connection);
					port.start();
					const receive = (message: Message) => {
						if (!message || typeof message.type !== "string") return;
						const reply = (value?: unknown, error?: unknown, ack?: string) => {
							if (message.requestId)
								port.postMessage({
									type: "reply",
									id: message.requestId,
									value,
									ack,
									error:
										error instanceof Error
											? error.message
											: error
												? String(error)
												: undefined,
								});
						};
						void (async () => {
							if (message.type === "hello") {
								if (connection.hello) return;
								if (
									!message.compatibility ||
									(["protocol", "schema", "definitions"] as const).some(
										(key) =>
											message.compatibility[key] !== options.compatibility[key],
									)
								) {
									port.postMessage({
										type: "incompatible",
										error:
											"Another application version owns the runtime. Finish active work and close older tabs before reopening.",
									});
									remove(connection);
									return;
								}
								connection.id = message.id;
								connection.hello = true;
								publish(connection, true);
								port.postMessage({
									type: "ready",
									epoch,
									compatibility: options.compatibility,
									lockName: options.lockName,
								});
								if (message.liveness)
									void options.locks
										.request(
											`vem-client:${message.id}`,
											{ signal: connection.lifetime.signal },
											() => remove(connection),
										)
										.catch(() => undefined);
								return;
							}
							if (!connection.hello) throw new Error("Handshake required");
							if (
								draining &&
								["run", "save-edit", "retry-action"].includes(message.type)
							)
								throw new Error("Runtime is preparing an upgrade");
							switch (message.type) {
								case "watch": {
									if (connection.queries.has(message.id)) return;
									if (connection.queries.size >= 1024)
										throw new Error("Too many simultaneous queries in one tab");
									connection.passiveQueries.delete(message.id);
									const handle = client.watch(message.query, {
										acquire: message.acquire,
									});
									connection.queries.set(message.id, handle);
									connection.stop.set(message.id, handle.subscribe(publishAll));
									publish(connection);
									break;
								}
								case "unwatch":
								case "forget-query": {
									connection.stop.get(message.id)?.();
									connection.queries.get(message.id)?.dispose();
									connection.queries.delete(message.id);
									connection.stop.delete(message.id);
									connection.passiveQueries.delete(message.id);
									if (message.type === "unwatch" && message.acquire !== false)
										connection.passiveQueries.set(message.id, message.query);
									else connection.previous.delete(message.id);
									for (const id of [...connection.passiveQueries.keys()].slice(
										0,
										Math.max(
											0,
											connection.passiveQueries.size - maxInactiveQueries,
										),
									)) {
										connection.passiveQueries.delete(id);
										connection.previous.delete(id);
										connection.forgottenQueries.add(id);
									}
									publishAll();
									break;
								}
								case "watch-read-status": {
									if (connection.readStatuses.has(message.id)) return;
									if (connection.readStatuses.size >= 1024)
										throw new Error(
											"Too many simultaneous read-status observers in one tab",
										);
									const handle = client.watchReadStatus(message.query);
									connection.readStatuses.set(message.id, handle);
									connection.stop.set(
										`read-status:${message.id}`,
										handle.subscribe(publishAll),
									);
									publish(connection);
									break;
								}
								case "unwatch-read-status": {
									const id = `read-status:${message.id}`;
									connection.stop.get(id)?.();
									connection.stop.delete(id);
									connection.readStatuses.get(message.id)?.dispose();
									connection.readStatuses.delete(message.id);
									connection.previousReadStatuses.delete(message.id);
									break;
								}
								case "retry-read-status": {
									const handle = client.watchReadStatus(message.query);
									try {
										reply(await handle.retry());
									} finally {
										handle.dispose();
									}
									break;
								}
								case "cancel-read":
									if (message.requestId)
										connection.reads.get(message.requestId)?.abort();
									break;
								case "read": {
									if (!message.requestId) break;
									if (!message.retry) {
										const controller = new AbortController();
										connection.reads.set(message.requestId, controller);
										try {
											reply(
												await client.read(message.query, {
													signal: controller.signal,
												}),
											);
										} finally {
											connection.reads.delete(message.requestId);
										}
									} else {
										const handle = client.watch(message.query);
										try {
											reply(await handle.retry());
										} finally {
											handle.dispose();
										}
									}
									break;
								}
								case "run":
									remember(
										client.run(message.command, {
											id: message.id,
											origin: connection.id,
										}),
									);
									publishAll();
									break;
								case "availability":
									connection.commands.set(message.id, message.command);
									publish(connection);
									break;
								case "unavailability":
									connection.commands.delete(message.id);
									break;
								case "prepare-edit":
									reply(await client.prepareEdit(message.descriptor));
									break;
								case "save-edit":
									remember(
										client.saveEdit(message.prepared, message.values, {
											id: message.id,
											origin: connection.id,
										}),
									);
									publishAll();
									break;
								case "cancel": {
									await client.action(message.id).cancel();
									reply();
									break;
								}
								case "retry-action": {
									remember(
										client
											.action(message.id)
											.retry({ id: message.nextId, origin: connection.id }),
									);
									publishAll();
									break;
								}
								case "revoke":
									client.revoke(message.scope);
									publishAll();
									break;
								case "feedback":
									if (message.ids.length)
										connection.feedback.set(message.claim, message.ids);
									else connection.feedback.delete(message.claim);
									publishAll();
									break;
								case "query-feedback":
									if (message.queryId)
										connection.feedbackQueries.set(
											message.claim,
											message.queryId,
										);
									else connection.feedbackQueries.delete(message.claim);
									publishAll();
									break;
								case "acknowledge-feedback": {
									const action = client
										.listActivities()
										.find((action) => action.id === message.id);
									if (action && feedbackStage(action) === message.stage) {
										acknowledgements.set(message.id, message.stage);
										publishAll();
									}
									break;
								}
								case "snapshot":
									publish(connection, true);
									break;
								case "disconnect":
									remove(connection);
									break;
								case "retire-ack":
									if (retiring === connection) release();
									break;
								case "upgrade": {
									if (draining) {
										reply({
											ready: false,
											reason: "An upgrade is already being prepared",
										});
										break;
									}
									if (
										client
											.listActivities()
											.some((action) => action.phase !== "settled")
									) {
										reply({
											ready: false,
											reason: "Active work must finish before upgrading",
										});
										break;
									}
									draining = true;
									try {
										await client.flush?.();
									} catch {
										draining = false;
										reply({
											ready: false,
											reason: "Recovery storage could not be saved",
										});
										break;
									}
									retiring = connection;
									reply({ ready: true }, undefined, "retire");
									break;
								}
							}
						})().catch((error) => {
							if (message.requestId) reply(undefined, error);
							else
								port.postMessage({
									type: "action-error",
									id: message.nextId || message.id,
									error: error instanceof Error ? error.message : String(error),
								});
						});
					};
					port.addEventListener("message", (event) => {
						const messages =
							event.data?.type === "batch" && Array.isArray(event.data.messages)
								? event.data.messages
								: [event.data];
						for (const message of messages) receive(message);
					});
				};
				resolve(attach);
				await lifetime;
				unsubscribe();
				for (const connection of connections)
					connection.port.postMessage({ type: "retired" });
				for (const connection of connections) remove(connection);
				await owner.dispose();
				client.close();
				options.onClosed?.();
			})
			.catch(reject);
	});
}

export { protocolVersion } from "./protocol.js";

export {
	type BackgroundTransferOwnerOptions,
	createBackgroundTransfers,
} from "./transfers/background.js";
export {
	type BackgroundTransferWorkerOptions,
	installBackgroundTransfers,
} from "./transfers/service-worker.js";
