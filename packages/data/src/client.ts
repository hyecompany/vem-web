// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { ClientOutbox } from "./client-outbox.js";
import { BrowserQueries } from "./client-queries.js";
import { BrowserReadStatuses } from "./client-read-status.js";
import { commandKey, stableKey } from "./descriptors.js";
import type { FeedbackClient, FeedbackObservation } from "./feedback-types.js";
import {
	type AccessSnapshot,
	type Compatibility,
	feedbackStage,
	type Publication,
	protocolVersion,
} from "./protocol.js";
import {
	applyReadModel,
	emptyReadModel,
	readModelDelta,
} from "./read-model/publication.js";
import type {
	AccessState,
	ActionHandle,
	ActionObservation,
	ActionOutcome,
	ActionSnapshot,
	Availability,
	CommandDescriptor,
	CommandResult,
	DataClient,
	EditDescriptor,
	PreparedEdit,
	QueryDescriptor,
	QueryHandle,
	QueryResult,
	QueryWatchOptions,
	ReadStatusHandle,
	ResourceReadDefinition,
	Watch,
} from "./types.js";

type Listener = () => void;
type CommandEntry = {
	value: Availability;
	listeners: Set<Listener>;
	bound: boolean;
};
type Pending = { resolve(value: unknown): void; reject(reason: unknown): void };
const UNKNOWN: Availability = Object.freeze({
	state: "blocked",
	reason: "Connecting to shared runtime",
});

export interface ConnectionSnapshot {
	phase: "connecting" | "ready" | "incompatible" | "failed" | "closed";
	owner?: Compatibility;
	updateAvailable: boolean;
	error?: string;
}

export class BrowserClient implements DataClient, FeedbackClient {
	readonly id: string;
	#port: MessagePort;
	#outbox: ClientOutbox;
	#worker?: SharedWorker;
	#workerError = () => this.#fail(new Error("The shared worker could not run"));
	#queries: BrowserQueries;
	#readStatuses: BrowserReadStatuses;
	#readModel = emptyReadModel();
	#commands = new Map<string, CommandEntry>();
	#activities: readonly ActionSnapshot[] = [];
	#access: AccessSnapshot = { contextId: "", revision: 0, scopes: {} };
	#listeners = new Set<Listener>();
	#pending = new Map<string, Pending>();
	#outcomes = new Map<string, Pending[]>();
	#feedback: readonly string[] = [];
	#epoch = "";
	#revision = 0;
	#ready = false;
	#closed = false;
	#queue: unknown[] = [];
	#release?: () => void;
	#error?: Error;
	#fallbacks = new Map<string, ActionSnapshot>();
	#compatibility: Compatibility;
	#connection: ConnectionSnapshot = {
		phase: "connecting",
		updateAvailable: false,
	};
	#locks?: LockManager;
	#ownerWatch?: AbortController;
	#ownerReleased?: Promise<void>;
	#retiring = false;
	#admissions = new Map<string, string | undefined>();

	constructor(
		port: MessagePort,
		compatibility: Compatibility,
		options: {
			id?: string;
			locks?: LockManager;
			worker?: SharedWorker;
			maxInactiveQueries?: number;
			readDefinitions?: readonly ResourceReadDefinition[];
		} = {},
	) {
		if (compatibility.protocol !== protocolVersion)
			throw new Error(`This client requires protocol ${protocolVersion}`);
		const maxInactiveQueries = options.maxInactiveQueries ?? 100;
		if (!Number.isInteger(maxInactiveQueries) || maxInactiveQueries < 0)
			throw new RangeError("maxInactiveQueries must be a nonnegative integer");
		this.#outbox = new ClientOutbox(port, (error) => this.#fail(error));
		this.#queries = new BrowserQueries(
			options.readDefinitions ?? [],
			{
				send: (message) => this.#send(message),
				retry: (query) => this.#request("read", { query, retry: true }),
			},
			maxInactiveQueries,
		);
		this.#readStatuses = new BrowserReadStatuses({
			send: (message) => this.#send(message),
			retry: (query) => this.#request("retry-read-status", { query }),
		});
		this.id = options.id ?? crypto.randomUUID();
		this.#compatibility = compatibility;
		this.#locks = options.locks;
		this.#port = port;
		this.#worker = options.worker;
		this.#worker?.addEventListener("error", this.#workerError);
		port.addEventListener("message", this.#message);
		port.addEventListener("messageerror", () =>
			this.#fail(new Error("Unreadable runtime message")),
		);
		port.start();
		const hello = () =>
			port.postMessage({
				type: "hello",
				id: this.id,
				compatibility,
				liveness: Boolean(options.locks),
			});
		if (options.locks) {
			void options.locks
				.request(
					`vem-client:${this.id}`,
					() =>
						new Promise<void>((resolve) => {
							this.#release = resolve;
							if (this.#closed) resolve();
							else hello();
						}),
				)
				.catch((error) => this.#fail(error));
		} else hello();
	}

	#message = (event: MessageEvent) => {
		if (this.#closed || this.#error) return;
		const message = event.data;
		if (!message || typeof message.type !== "string") return;
		if (message.type === "fatal" || message.type === "incompatible")
			return this.#fail(
				new Error(message.error),
				message.type === "incompatible" ? "incompatible" : "failed",
			);
		if (message.type === "retired")
			return this.#fail(
				new Error("The shared runtime was replaced. Reconnect to continue."),
				"closed",
			);
		if (message.type === "ready") {
			this.#ready = true;
			this.#connection = {
				phase: "ready",
				owner: message.compatibility,
				updateAvailable: Boolean(
					message.compatibility &&
						message.compatibility.build !== this.#compatibility.build,
				),
			};
			if (
				this.#locks &&
				typeof message.lockName === "string" &&
				!this.#ownerWatch
			) {
				this.#ownerWatch = new AbortController();
				const signal = this.#ownerWatch.signal;
				this.#ownerReleased = this.#locks.request(
					message.lockName,
					{ signal },
					() => {
						if (!this.#closed && !this.#error)
							this.#fail(
								new Error(
									"The shared runtime owner disconnected. Reconnect to recover its work.",
								),
							);
					},
				);
				void this.#ownerReleased.catch((error) => {
					if (!signal.aborted) this.#fail(error);
				});
			}
			for (const queued of this.#queue.splice(0)) {
				if (this.#closed || this.#error) break;
				this.#outbox.send(queued);
			}
			for (const listener of this.#listeners) listener();
			return;
		}
		if (message.type === "action-withdrawn") {
			this.#withdrawAction(message.id);
			for (const listener of this.#listeners) listener();
			return;
		}
		if (message.type === "action-error") {
			const fallback = this.#fallbacks.get(message.id);
			const outcome: ActionOutcome = {
				kind: "failed",
				submitted: false,
				error: { message: String(message.error) },
			};
			if (fallback)
				this.#fallbacks.set(message.id, {
					...fallback,
					phase: "settled",
					outcome,
				});
			for (const pending of this.#outcomes.get(message.id) ?? [])
				pending.resolve(outcome);
			this.#outcomes.delete(message.id);
			for (const listener of this.#listeners) listener();
			return;
		}
		if (message.type === "reply") {
			if (message.ack === "retire") {
				this.#retiring = true;
				this.#send({ type: "retire-ack" });
			}
			const pending = this.#pending.get(message.id);
			this.#pending.delete(message.id);
			if (message.error) pending?.reject(new Error(message.error));
			else pending?.resolve(message.value);
			return;
		}
		if (message.type !== "publish") return;
		let publication = message as Publication;
		let quarantined = false;
		if (
			!publication.reset &&
			(publication.epoch !== this.#epoch || publication.base !== this.#revision)
		) {
			this.#send({ type: "snapshot" });
			if (
				this.#access.revision === publication.access.revision &&
				this.#access.contextId === publication.access.contextId &&
				this.#access.epoch === publication.access.epoch
			)
				return;
			// Lost disclosure updates cannot leave the prior replica readable during recovery.
			quarantined = true;
			publication = {
				...publication,
				epoch: this.#epoch,
				revision: this.#revision,
				reset: true,
				readModel: readModelDelta(emptyReadModel(), emptyReadModel(), true),
				queries: [],
				readStatuses: [],
			};
		}
		this.#epoch = publication.epoch;
		this.#revision = publication.revision;
		const notify = new Set<Listener>();
		const accessChanged =
			this.#access.revision !== publication.access.revision ||
			this.#access.contextId !== publication.access.contextId ||
			this.#access.epoch !== publication.access.epoch;
		this.#readModel = applyReadModel(
			this.#readModel,
			publication.readModel,
			publication.reset,
		);
		for (const update of publication.availability) {
			const entry = this.#commands.get(update.id);
			if (
				!entry ||
				JSON.stringify(entry.value) === JSON.stringify(update.value)
			)
				continue;
			entry.value = update.value;
			for (const listener of entry.listeners) notify.add(listener);
		}
		if (accessChanged) {
			if (this.#access.contextId)
				for (const id of this.#admissions.keys())
					this.#admissions.set(id, undefined);
			for (const [id, value] of this.#fallbacks)
				this.#fallbacks.set(id, {
					...value,
					target: undefined,
					references: undefined,
					progress: undefined,
					outcome: undefined,
				});
		}
		this.#access = publication.access;
		const retained = new Set(publication.activities.map((action) => action.id));
		for (const action of this.#activities)
			if (!retained.has(action.id)) this.#withdrawAction(action.id);
		this.#activities = publication.activities;
		this.#feedback = publication.feedback;
		for (const action of this.#activities) {
			if (
				this.#fallbacks.has(action.id) &&
				this.#fallbacks.get(action.id)?.outcome?.kind !== "failed"
			)
				this.#fallbacks.set(action.id, action);
			if (!action.outcome) continue;
			for (const pending of this.#outcomes.get(action.id) ?? [])
				pending.resolve(action.outcome);
			this.#outcomes.delete(action.id);
		}
		for (const listener of this.#queries.apply(
			this.#readModel,
			this.#access,
			this.#activities,
			publication.queries,
			publication.reset,
			accessChanged,
			quarantined,
			publication.forgottenQueries,
		))
			notify.add(listener);
		for (const listener of this.#readStatuses.apply(
			publication.readStatuses ?? [],
			publication.reset || accessChanged,
		))
			notify.add(listener);
		for (const listener of this.#listeners) notify.add(listener);
		for (const listener of notify) listener();
	};

	#withdrawAction(id: string): void {
		const previous = this.#fallbacks.get(id);
		if (!previous && !this.#outcomes.has(id)) return;
		const outcome: ActionOutcome = {
			kind: "unknown",
			message:
				"This activity is no longer available to this observer; server work may still continue",
		};
		if (previous)
			this.#fallbacks.set(id, {
				id,
				resource: "",
				name: "",
				contextId: this.#access.contextId,
				phase: "settled",
				recovery: "unavailable",
				revision: previous.revision + 1,
				controls: { canCancel: false, canRetry: false },
				outcome,
			});
		for (const pending of this.#outcomes.get(id) ?? [])
			pending.resolve(outcome);
		this.#outcomes.delete(id);
		this.#admissions.set(id, undefined);
	}

	#fail(error: unknown, phase: ConnectionSnapshot["phase"] = "failed") {
		this.#worker?.removeEventListener("error", this.#workerError);
		this.#worker = undefined;
		this.#error = error instanceof Error ? error : new Error(String(error));
		this.#connection = {
			...this.#connection,
			phase,
			error: this.#error.message,
		};
		this.#queue = [];
		this.#outbox.clear();
		for (const id of this.#admissions.keys())
			this.#admissions.set(id, undefined);
		if (!this.#retiring || phase !== "closed") this.#ownerWatch?.abort();
		this.#release?.();
		this.#release = undefined;
		const outcome: ActionOutcome = {
			kind: "unknown",
			message: this.#error.message,
		};
		const settle = (value: ActionSnapshot): ActionSnapshot =>
			value.phase === "settled"
				? value
				: {
						...value,
						phase: "settled",
						controls: { canCancel: false, canRetry: false },
						outcome,
					};
		for (const [id, value] of this.#fallbacks)
			this.#fallbacks.set(id, {
				...value,
				phase: "settled",
				controls: { canCancel: false, canRetry: false },
				outcome,
			});
		this.#activities = this.#activities.map(settle);
		for (const pending of this.#pending.values()) pending.reject(this.#error);
		this.#pending.clear();
		for (const pending of this.#outcomes.values())
			for (const item of pending)
				item.resolve({ kind: "unknown", message: this.#error.message });
		this.#outcomes.clear();
		const notify = this.#queries.fail(
			this.#error,
			this.#access,
			this.#activities,
		);
		for (const listener of this.#readStatuses.fail(this.#error))
			notify.add(listener);
		for (const entry of this.#commands.values()) {
			entry.value = { state: "blocked", reason: this.#error.message };
			for (const listener of entry.listeners) notify.add(listener);
		}
		for (const listener of this.#listeners) notify.add(listener);
		for (const listener of notify) listener();
	}

	#send(message: unknown) {
		if (this.#closed || this.#error) return;
		if (this.#ready) this.#outbox.send(message);
		else {
			const update = message as { type?: string; id?: string };
			if (
				[
					"unwatch",
					"forget-query",
					"unavailability",
					"unwatch-read-status",
				].includes(update.type ?? "")
			) {
				const pendingType =
					update.type === "unavailability"
						? "availability"
						: update.type === "unwatch-read-status"
							? "watch-read-status"
							: "watch";
				this.#queue = this.#queue.filter((value) => {
					const queued = value as { type?: string; id?: string };
					return queued.type !== pendingType || queued.id !== update.id;
				});
			} else {
				try {
					this.#queue.push(structuredClone(message));
				} catch (error) {
					this.#fail(error);
				}
			}
		}
	}

	#request<T>(type: string, payload: object, signal?: AbortSignal): Promise<T> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (this.#error || this.#closed)
			return Promise.reject(this.#error ?? new Error("Client closed"));
		const id = crypto.randomUUID();
		return new Promise<T>((resolve, reject) => {
			const cleanup = () => signal?.removeEventListener("abort", abort);
			const abort = () => {
				if (!this.#pending.delete(id)) return;
				cleanup();
				if (this.#ready) this.#send({ type: "cancel-read", requestId: id });
				else
					this.#queue = this.#queue.filter(
						(message) => (message as { requestId?: string }).requestId !== id,
					);
				reject(signal?.reason);
			};
			this.#pending.set(id, {
				resolve: (value) => {
					cleanup();
					resolve(value as T);
				},
				reject: (error) => {
					cleanup();
					reject(error);
				},
			});
			signal?.addEventListener("abort", abort, { once: true });
			this.#send({ type, ...payload, requestId: id });
		});
	}

	watch<T extends object, I>(
		descriptor: QueryDescriptor<T, I>,
		options?: QueryWatchOptions,
	): QueryHandle<T, I> {
		return this.#queries.watch(descriptor, options);
	}

	watchReadStatus<T extends object, I>(
		query: QueryDescriptor<T, I>,
	): ReadStatusHandle {
		return this.#readStatuses.watch(query as QueryDescriptor);
	}

	read<T extends object, I>(
		query: QueryDescriptor<T, I>,
		options?: { signal?: AbortSignal },
	): Promise<QueryResult<T, I>> {
		return this.#request<QueryResult<T, I>>("read", { query }, options?.signal);
	}

	#handle<O extends ActionOutcome>(
		id: string,
		descriptor: Pick<CommandDescriptor<unknown, O>, "resource" | "name">,
	): ActionHandle<O> {
		const retryDescriptor = {
			resource: descriptor.resource,
			name: descriptor.name,
		};
		const fallback: ActionSnapshot<O> = {
			id,
			resource: descriptor.resource,
			name: descriptor.name,
			phase: "admitting",
			contextId: this.#access.contextId,
			origin: this.id,
			recovery: "pending",
			revision: 0,
			controls: { canCancel: false, canRetry: false },
		};
		if (!this.#fallbacks.has(id))
			this.#fallbacks.set(id, fallback as ActionSnapshot);
		const local = this.#fallbacks.get(id)?.outcome;
		const existing =
			local?.kind === "failed" && local.submitted === false
				? local
				: (this.#activities.find((action) => action.id === id)?.outcome ??
					local);
		const result = existing
			? Promise.resolve(existing as O)
			: new Promise<O>((resolve) => {
					const pending = this.#outcomes.get(id) ?? [];
					pending.push({
						resolve: (value) => resolve(value as O),
						reject: () => undefined,
					});
					this.#outcomes.set(id, pending);
				});
		return {
			id,
			result,
			getSnapshot: () => {
				const local = this.#fallbacks.get(id);
				if (
					local?.outcome?.kind === "failed" &&
					local.outcome.submitted === false
				)
					return local as ActionSnapshot<O>;
				return (
					((this.#activities.find((action) => action.id === id) ?? local) as
						| ActionSnapshot<O>
						| undefined) ?? fallback
				);
			},
			subscribe: (listener) => this.subscribe(listener),
			cancel: () => this.#request("cancel", { id }),
			retry: (options) => this.#retry<O>(id, retryDescriptor, options),
		};
	}

	#retry<O extends ActionOutcome>(
		id: string,
		descriptor: Pick<CommandDescriptor<unknown, O>, "resource" | "name">,
		options?: { id?: string; origin?: string },
	): ActionHandle<O> {
		const nextId = options?.id ?? crypto.randomUUID();
		const fresh = this.#admit(nextId, { retry: id });
		const next = this.#handle<O>(nextId, descriptor);
		if (fresh) this.#send({ type: "retry-action", id, nextId });
		if (this.#error || this.#closed)
			this.#fail(
				this.#error ?? new Error("Client closed"),
				this.#closed ? "closed" : "failed",
			);
		return next;
	}

	#admit(id: string, input: unknown): boolean {
		const fingerprint = commandKey(input);
		if (this.#admissions.has(id)) {
			if (this.#admissions.get(id) !== fingerprint)
				throw new Error(
					"Action ID was already used with different input or a retired access state",
				);
			return false;
		}
		this.#admissions.set(id, fingerprint);
		return true;
	}

	run<O extends ActionOutcome>(
		command: CommandDescriptor<unknown, O>,
		options?: { id?: string; origin?: string },
	): ActionHandle<O> {
		const id = options?.id ?? crypto.randomUUID();
		const fresh = this.#admit(id, command);
		const handle = this.#handle<O>(id, command);
		if (fresh) this.#send({ type: "run", id, command });
		if (this.#error || this.#closed)
			this.#fail(this.#error ?? new Error("Client closed"));
		return handle;
	}

	action(id: string): ActionObservation {
		const current = () => {
			const action = this.#activities.find((action) => action.id === id);
			if (!action) throw new Error("This activity is no longer available");
			return action;
		};
		return {
			getSnapshot: () => this.#activities.find((action) => action.id === id),
			subscribe: (listener) => this.subscribe(listener),
			cancel: async () => {
				if (!current().controls.canCancel)
					throw new Error("This action cannot be canceled");
				return this.#request("cancel", { id });
			},
			retry: (options) => {
				const action = current();
				if (!action.controls.canRetry)
					throw new Error("The action cannot safely be retried");
				return this.#retry(id, action, options);
			},
		};
	}
	listActivities = () => this.#activities;
	subscribeActivities = (listener: Listener) => this.subscribe(listener);
	subscribe = (listener: Listener) => {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};
	availability(command: CommandDescriptor): Availability {
		return this.#commands.get(commandKey(command))?.value ?? UNKNOWN;
	}
	watchAvailability(command: CommandDescriptor): Watch<Availability> {
		const id = commandKey(command);
		const owned = new Set<() => void>();
		return {
			getSnapshot: () => this.#commands.get(id)?.value ?? UNKNOWN,
			subscribe: (listener) => {
				let entry = this.#commands.get(id);
				if (!entry) {
					entry = { value: UNKNOWN, listeners: new Set(), bound: false };
					this.#commands.set(id, entry);
				}
				entry.listeners.add(listener);
				if (!entry.bound) {
					entry.bound = true;
					this.#send({ type: "availability", id, command });
				}
				const state = entry;
				const release = () => {
					owned.delete(release);
					state.listeners.delete(listener);
					if (state.listeners.size === 0 && this.#commands.get(id) === state) {
						state.value = UNKNOWN;
						this.#commands.delete(id);
						this.#send({ type: "unavailability", id });
					}
				};
				owned.add(release);
				return release;
			},
			dispose: () => {
				for (const release of owned) release();
			},
		};
	}
	prepareEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		descriptor: EditDescriptor<T, unknown, O>,
	): Promise<PreparedEdit<T, O>> {
		return this.#request("prepare-edit", { descriptor });
	}
	saveEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		prepared: PreparedEdit<T, O>,
		values: T,
		options?: { id?: string; origin?: string },
	): ActionHandle<CommandResult<O>> {
		const id = options?.id ?? crypto.randomUUID();
		const fresh = this.#admit(id, { prepared, values });
		const handle = this.#handle<CommandResult<O>>(id, {
			resource: prepared.descriptor.resource,
			name: prepared.descriptor.name,
		});
		if (fresh) this.#send({ type: "save-edit", id, prepared, values });
		if (this.#error || this.#closed)
			this.#fail(
				this.#error ?? new Error("Client closed"),
				this.#closed ? "closed" : "failed",
			);
		return handle;
	}
	access(scope: string): AccessState {
		return this.#access.scopes[scope]?.state ?? "unknown";
	}
	accessSnapshot = () => this.#access;
	revoke(scope: string): void {
		this.#send({ type: "revoke", scope });
	}
	subscribeFeedback = (listener: () => void) => this.subscribe(listener);
	feedback = () => this.#feedback;
	acknowledgeFeedback(id: string, observed?: FeedbackObservation): void {
		const action =
			observed ?? this.#activities.find((action) => action.id === id);
		if (action)
			this.#send({
				type: "acknowledge-feedback",
				id,
				stage: feedbackStage(action),
			});
	}
	claimFeedback(ids: readonly string[]): () => void {
		const claim = crypto.randomUUID();
		this.#send({ type: "feedback", claim, ids });
		return () => this.#send({ type: "feedback", claim, ids: [] });
	}
	claimQueryFeedback<T extends object, I>(
		query: QueryDescriptor<T, I>,
	): () => void {
		const claim = crypto.randomUUID();
		this.#send({ type: "query-feedback", claim, queryId: stableKey(query) });
		return () => this.#send({ type: "query-feedback", claim });
	}
	async upgrade(): Promise<{ ready: boolean; reason?: string }> {
		if (!this.#locks)
			return {
				ready: false,
				reason: "Ownership release cannot be verified without Web Locks",
			};
		const result = await this.#request<{ ready: boolean; reason?: string }>(
			"upgrade",
			{},
		);
		if (result.ready) await this.#ownerReleased;
		return result;
	}
	connectionSnapshot = (): ConnectionSnapshot => this.#connection;
	close(): void {
		if (this.#closed) return;
		this.#retiring = false;
		this.#send({ type: "disconnect" });
		this.#outbox.flush();
		this.#closed = true;
		this.#fail(new Error("Client closed"), "closed");
		this.#port.removeEventListener("message", this.#message);
		this.#port.close();
		this.#release?.();
	}
}

/** Attach a browser tab to the stable shared owner. Requires SharedWorker and Web Locks; provide pure readDefinitions for synchronous local projection. */
export function connectSharedWorker(
	url: string | URL,
	compatibility: Compatibility,
	options: {
		maxInactiveQueries?: number;
		readDefinitions?: readonly ResourceReadDefinition[];
	} = {},
): BrowserClient {
	if (typeof SharedWorker === "undefined" || !navigator.locks)
		throw new Error(
			"This application requires SharedWorker and Web Locks support",
		);
	const worker = new SharedWorker(url, { type: "module", name: "vem-data" });
	return new BrowserClient(worker.port, compatibility, {
		locks: navigator.locks,
		worker,
		maxInactiveQueries: options.maxInactiveQueries,
		readDefinitions: options.readDefinitions,
	});
}

export type { Compatibility } from "./protocol.js";
export { protocolVersion } from "./protocol.js";
export {
	attachBackgroundTransfers,
	type BackgroundTransferPageOptions,
} from "./transfers/page.js";
export type { ResourceReadDefinition } from "./types.js";
