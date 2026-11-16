// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { BrowserClient, protocolVersion } from "../../src/client.js";
import type { Compatibility } from "../../src/protocol.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type {
	ResourceDefinition,
	ResourceReadDefinition,
} from "../../src/types.js";
import { createSharedHost } from "../../src/worker.js";

export const compatibility: Compatibility = {
	protocol: protocolVersion,
	schema: 1,
	definitions: 1,
	build: "first",
};
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
export async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await tick();
	}
	assert.ok(predicate(), "Expected publication did not arrive");
}

export class Locks implements LockManager {
	#queues = new Map<string, { start(): void; abort(): void }[]>();
	#active = new Map<string, { release(): void }>();
	request<T>(
		name: string,
		options: LockOptions | ((lock: Lock | null) => T | PromiseLike<T>),
		callback?: (lock: Lock | null) => T | PromiseLike<T>,
	): Promise<T> {
		const fn = typeof options === "function" ? options : callback;
		const signal = typeof options === "function" ? undefined : options.signal;
		return new Promise<T>((resolve, reject) => {
			let granted = false;
			const entry = {
				start: () => {
					granted = true;
					signal?.removeEventListener("abort", entry.abort);
					const held = {
						release: () => {
							if (this.#active.get(name) === held) this.#active.delete(name);
							this.#drain(name);
						},
					};
					this.#active.set(name, held);
					void Promise.resolve()
						.then(() => fn?.({ name, mode: "exclusive" }))
						.then((value) => resolve(value as T), reject)
						.finally(held.release);
				},
				abort: () => {
					if (granted) return;
					this.#queues.set(
						name,
						(this.#queues.get(name) ?? []).filter((item) => item !== entry),
					);
					reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
				},
			};
			if (signal?.aborted) {
				entry.abort();
				return;
			}
			const queue = this.#queues.get(name) ?? [];
			queue.push(entry);
			this.#queues.set(name, queue);
			signal?.addEventListener("abort", entry.abort, { once: true });
			queueMicrotask(() => this.#drain(name));
		});
	}
	#drain(name: string): void {
		if (!this.#active.has(name)) this.#queues.get(name)?.shift()?.start();
	}
	abandon(name: string): void {
		this.#active.get(name)?.release();
	}
	async query(): Promise<LockManagerSnapshot> {
		return {
			held: [...this.#active.keys()].map((name) => ({
				name,
				mode: "exclusive",
			})),
			pending: [],
		};
	}
}

export function channel(
	t: TestContext,
	attach?: (port: MessagePort) => void,
	options: {
		locks?: LockManager;
		compatibility?: Compatibility;
		maxInactiveQueries?: number;
		readDefinitions?: readonly ResourceReadDefinition[];
	} = {},
) {
	const pair = new MessageChannel();
	const client = new BrowserClient(
		pair.port1,
		options.compatibility ?? compatibility,
		{
			locks: options.locks,
			maxInactiveQueries: options.maxInactiveQueries,
			readDefinitions: options.readDefinitions ?? [{ name: "things" }],
		},
	);
	const messages: Record<string, unknown>[] = [];
	if (attach) attach(pair.port2);
	else {
		pair.port2.addEventListener("message", (event) =>
			messages.push(
				...(event.data.type === "batch" ? event.data.messages : [event.data]),
			),
		);
		pair.port2.start();
	}
	t.after(() => {
		client.close();
		pair.port2.close();
	});
	return { client, peer: pair.port2, port: pair.port1, messages };
}

export async function host(
	t: TestContext,
	definition: ResourceDefinition,
	locks = new Locks(),
	limits: { runtime?: number; resources?: readonly ResourceDefinition[] } = {},
) {
	const runtime = createRuntime({
		resources: [definition, ...(limits.resources ?? [])],
		maxInactiveQueries: limits.runtime,
		contextId: "alice",
		access: [{ scope: "read", state: "allowed" }],
	});
	await runtime.ready;
	const disposed = deferred<void>();
	const attach = await createSharedHost({
		compatibility,
		lockName: "owner",
		locks,
		create: async () => ({
			client: runtime,
			dispose: () => disposed.resolve(),
		}),
	});
	t.after(() => runtime.close());
	return { runtime, locks, attach, disposed };
}
