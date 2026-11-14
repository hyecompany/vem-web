// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { commandKey } from "../descriptors.js";
import type {
	Availability,
	CommandDescriptor,
	DataClient,
	QueryDescriptor,
	QueryResult,
} from "../types.js";
import { delegateClient } from "./delegate.js";
import type {
	ClientInspector,
	CommandInspection,
	EditInspection,
	InspectionSnapshot,
	QueryInspection,
} from "./types.js";
import { inspectWatch } from "./watch-inspection.js";

export function inspectClient(
	source: DataClient,
	options: { mode?: "live" | "scenario"; limit?: number } = {},
): ClientInspector {
	const queries = new Map<string, QueryInspection>();
	const commands = new Map<string, CommandInspection>();
	const edits = new Map<string, EditInspection>();
	const queryReaders = new Map<string, Map<symbol, () => QueryResult>>();
	const commandReaders = new Map<string, Map<symbol, () => Availability>>();
	const liveIds = new Map<string, string>();
	const preparing = new Map<string, symbol>();
	const listeners = new Set<() => void>();
	const limit = options.limit ?? 100;
	const live = options.mode !== "scenario";
	let closed = false;
	let queued = false;
	let snapshot: InspectionSnapshot = {
		revision: 0,
		mode: options.mode ?? "live",
		queries: [],
		commands: [],
		edits: [],
		actions: [],
	};
	let previousAccess = source.accessSnapshot();
	const idFor = (descriptor: unknown) => {
		const key = commandKey(descriptor);
		if (!live) return key;
		let id = liveIds.get(key);
		if (!id) {
			id = crypto.randomUUID();
			liveIds.set(key, id);
		}
		return id;
	};
	const safeCommand = (descriptor: CommandDescriptor): CommandDescriptor => ({
		kind: "command",
		resource: descriptor.resource,
		name: descriptor.name,
		target: descriptor.target,
		input: live ? undefined : descriptor.input,
	});
	const safeResult = (result: QueryResult): QueryResult =>
		live
			? {
					...result,
					issues: result.issues.map((issue) => ({
						kind: issue.kind,
						message:
							issue.kind === "read"
								? "Acquisition failed; see the consumer's error state"
								: issue.message,
					})),
				}
			: result;
	const trim = <T extends { subscribers?: number }>(
		entries: Map<string, T>,
	) => {
		for (const [id, value] of entries) {
			if (entries.size <= limit) break;
			if (!value.subscribers) entries.delete(id);
		}
	};
	const publish = () => {
		if (closed) return;
		trim(queries);
		trim(commands);
		while (edits.size > limit)
			edits.delete(edits.keys().next().value as string);
		for (const [key, id] of liveIds)
			if (!queries.has(id) && !commands.has(id) && !edits.has(id))
				liveIds.delete(key);
		snapshot = {
			revision: snapshot.revision + 1,
			mode: options.mode ?? "live",
			queries: [...queries.values()],
			commands: [...commands.values()],
			edits: [...edits.values()],
			actions: source.listActivities(),
		};
		if (queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			if (!closed) for (const listener of listeners) listener();
		});
	};
	const stop = source.subscribe(() => {
		const access = source.accessSnapshot();
		const contextChanged =
			(previousAccess.contextId !== "" &&
				access.contextId !== previousAccess.contextId) ||
			(previousAccess.epoch !== undefined &&
				access.epoch !== previousAccess.epoch);
		const withdrawn =
			contextChanged ||
			Object.entries(previousAccess.scopes).some(([scope, previous]) => {
				const next = access.scopes[scope];
				return (
					(previous.state === "allowed" && next?.state !== "allowed") ||
					(next !== undefined && next.generation !== previous.generation)
				);
			});
		previousAccess = access;
		if (withdrawn) {
			if (live) {
				liveIds.clear();
				preparing.clear();
				edits.clear();
				for (const [id, entry] of queries) {
					if (!entry.subscribers) queries.delete(id);
					else
						queries.set(id, {
							...entry,
							descriptor: {
								kind: "query",
								resource: entry.descriptor.resource,
								mode: entry.descriptor.mode,
								select: entry.descriptor.select,
							},
						});
				}
				for (const [id, entry] of commands) {
					if (!entry.subscribers) commands.delete(id);
					else
						commands.set(id, {
							...entry,
							descriptor: { ...entry.descriptor, target: undefined },
						});
				}
			} else
				for (const [id, entry] of edits)
					edits.set(id, { ...entry, etag: undefined, message: undefined });
		}
		for (const [id, readers] of queryReaders) {
			const current = queries.get(id);
			const read = readers.values().next().value;
			if (current && read)
				queries.set(id, { ...current, result: safeResult(read()) });
		}
		for (const [id, readers] of commandReaders) {
			const current = commands.get(id);
			const read = readers.values().next().value;
			if (current && read)
				commands.set(id, { ...current, availability: read() });
		}
		publish();
	});
	const stopActions = source.subscribeActivities(publish);
	const client = delegateClient(source, {
		watch(descriptor, watchOptions) {
			const handle = source.watch(descriptor, watchOptions);
			return {
				...handle,
				...inspectWatch(handle, (read) => {
					if (closed) return () => undefined;
					const id = idFor(descriptor);
					const token = Symbol();
					const readers =
						queryReaders.get(id) ?? new Map<symbol, () => QueryResult>();
					readers.set(token, read as () => QueryResult);
					queryReaders.set(id, readers);
					queries.set(id, {
						id,
						descriptor: descriptor as QueryDescriptor,
						subscribers: readers.size,
						result: safeResult(read() as QueryResult),
					});
					publish();
					return () => {
						readers.delete(token);
						if (!readers.size) queryReaders.delete(id);
						const current = queries.get(id);
						if (current)
							queries.set(id, {
								...current,
								subscribers: readers.size,
								result: readers.size
									? safeResult(readers.values().next().value?.() as QueryResult)
									: undefined,
							});
						publish();
					};
				}),
			};
		},
		async read(descriptor, readOptions) {
			if (!closed) {
				const id = idFor(descriptor);
				if (!queries.has(id))
					queries.set(id, {
						id,
						descriptor: descriptor as QueryDescriptor,
						subscribers: 0,
					});
				publish();
			}
			return source.read(descriptor, readOptions);
		},
		watchAvailability(descriptor) {
			const handle = source.watchAvailability(descriptor);
			const id = idFor(descriptor);
			const metadata = safeCommand(descriptor);
			return inspectWatch(handle, (read) => {
				if (closed) return () => undefined;
				const token = Symbol();
				const readers =
					commandReaders.get(id) ?? new Map<symbol, () => Availability>();
				readers.set(token, read);
				commandReaders.set(id, readers);
				commands.set(id, {
					id,
					descriptor: metadata,
					subscribers: readers.size,
					availability: read(),
				});
				publish();
				return () => {
					readers.delete(token);
					if (!readers.size) commandReaders.delete(id);
					const current = commands.get(id);
					if (current)
						commands.set(id, { ...current, subscribers: readers.size });
					publish();
				};
			});
		},
		run(descriptor, runOptions) {
			if (!closed) {
				const id = idFor(descriptor);
				if (!commands.has(id))
					commands.set(id, {
						id,
						descriptor: safeCommand(descriptor),
						subscribers: 0,
						availability: source.availability(descriptor),
					});
			}
			const action = source.run(descriptor, runOptions);
			publish();
			return action;
		},
		async prepareEdit(descriptor) {
			const id = idFor(descriptor),
				token = Symbol();
			if (!closed) {
				preparing.set(id, token);
				edits.set(id, {
					id,
					descriptor: descriptor as EditInspection["descriptor"],
					fields: [],
					status: "preparing",
				});
				publish();
			}
			try {
				const prepared = await source.prepareEdit(descriptor);
				const current = edits.get(id);
				if (!closed && current && preparing.get(id) === token) {
					edits.set(id, {
						...current,
						status: "ready",
						fields: Object.keys(prepared.fieldDisclosure),
						etag: prepared.etag,
					});
					publish();
				}
				return prepared;
			} catch (error) {
				const current = edits.get(id);
				if (!closed && current && preparing.get(id) === token) {
					edits.set(id, {
						...current,
						status: "failed",
						message:
							"Editor preparation failed; see the consumer's error state",
					});
					publish();
				}
				throw error;
			} finally {
				if (preparing.get(id) === token) preparing.delete(id);
			}
		},
	});
	return {
		client,
		subscribe(listener) {
			if (closed) return () => undefined;
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => snapshot,
		close() {
			closed = true;
			stop();
			stopActions();
			queries.clear();
			commands.clear();
			edits.clear();
			queryReaders.clear();
			commandReaders.clear();
			liveIds.clear();
			preparing.clear();
			listeners.clear();
			snapshot = {
				...snapshot,
				queries: [],
				commands: [],
				edits: [],
				actions: [],
			};
		},
	};
}
