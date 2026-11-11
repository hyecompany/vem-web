// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { DexiePersistence } from "../persistence.js";
import type {
	TransferExecutor,
	TransferObserver,
	TransferReceipt,
	TransferRequest,
	TransferUnavailable,
} from "../transfer-types.js";
import {
	type TransferMessage,
	type TransferReply,
	type TransferStatus,
	transferProtocol,
	unknownTransfer,
} from "./protocol.js";

export interface BackgroundTransferOwnerOptions {
	/** The same Dexie database used by this runtime's action journal. */
	databaseName: string;
	/** Must match attachBackgroundTransfers() and installBackgroundTransfers(). */
	channel: string;
}

/** Browser execution underneath ordinary commands; the shared owner still decides action outcomes. */
export function createBackgroundTransfers(
	options: BackgroundTransferOwnerOptions,
): TransferExecutor & { close(): void } {
	const persistence = new DexiePersistence(options.databaseName);
	const channel = new BroadcastChannel(options.channel);
	const lifetime = new AbortController();
	const pending = new Map<string, (value: TransferStatus) => void>();
	const changed = new Set<() => void>();
	channel.onmessage = (
		event: MessageEvent<TransferReply | { protocol: string; type: "changed" }>,
	) => {
		if (event.data?.protocol !== transferProtocol) return;
		if (event.data.type === "reply")
			pending.get(event.data.token)?.(event.data.value);
		if (event.data.type === "changed")
			for (const listener of changed) listener();
	};
	const rpc = (
		operation: TransferMessage["operation"],
		id: string,
		signal: AbortSignal,
		peer?: string,
		request?: TransferRequest,
	): Promise<TransferStatus> => {
		signal.throwIfAborted();
		const token = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timeout);
				pending.delete(token);
				signal.removeEventListener("abort", aborted);
			};
			const aborted = () => {
				cleanup();
				reject(signal.reason);
			};
			const timeout = setTimeout(
				() => {
					cleanup();
					resolve(
						operation === "probe"
							? {
									kind: "unavailable",
									reason:
										"No browser transfer host is available; keep an application tab open.",
								}
							: unknownTransfer(
									"The transfer acknowledgement was lost; the request was not repeated.",
								),
					);
				},
				operation === "probe" ? 5_000 : 35_000,
			);
			pending.set(token, (value) => {
				cleanup();
				resolve(value);
			});
			signal.addEventListener("abort", aborted, { once: true });
			try {
				channel.postMessage({
					protocol: transferProtocol,
					type: "request",
					token,
					operation,
					id,
					peer,
					request,
				});
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	};
	const waitForChange = (signal: AbortSignal) =>
		new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				changed.delete(wake);
				signal.removeEventListener("abort", abort);
			};
			const wake = () => {
				cleanup();
				resolve();
			};
			const abort = () => {
				cleanup();
				reject(signal.reason);
			};
			const timer = setTimeout(wake, 1000);
			changed.add(wake);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
		});
	async function observe(
		id: string,
		observer: TransferObserver,
		first?: TransferStatus,
	): Promise<TransferReceipt> {
		const signal = AbortSignal.any([observer.signal, lifetime.signal]);
		let value = first;
		let missingSince: number | undefined;
		while (true) {
			signal.throwIfAborted();
			const record = await persistence.readTransfer(id);
			signal.throwIfAborted();
			if (!record)
				return {
					kind: "unknown",
					message: "The transfer recovery record is unavailable.",
				};
			if (record.state === "accepted") observer.accepted();
			if (record.receipt?.kind === "response") return record.receipt;
			if (!value) value = await rpc("status", id, signal);
			if (value.kind === "receipt") return value.receipt;
			if (value.kind === "unavailable")
				return {
					kind: "unknown",
					message:
						"The browser transfer cannot currently be observed; it was not repeated.",
				};
			if (value.kind === "pending") {
				if (value.accepted) observer.accepted();
				observer.progress({ completed: value.completed, total: value.total });
				if (value.active) missingSince = undefined;
				else missingSince ??= Date.now();
				if (missingSince !== undefined && Date.now() - missingSince >= 30_000)
					return {
						kind: "unknown",
						message:
							"No active transfer or completion receipt could be established; the request was not repeated.",
					};
			}
			await waitForChange(signal);
			value = undefined;
		}
	}
	return {
		async start(
			id,
			request,
			observer,
		): Promise<TransferReceipt | TransferUnavailable> {
			const signal = AbortSignal.any([observer.signal, lifetime.signal]);
			const capability = await rpc("probe", id, signal);
			signal.throwIfAborted();
			if (capability.kind === "unavailable") return capability;
			if (capability.kind !== "ready")
				return {
					kind: "unknown",
					message: "The browser transfer host gave an unexpected response.",
				};
			if (!observer.canSubmit())
				return {
					kind: "unavailable",
					reason: "Access changed before transfer submission.",
				};
			const status = await rpc("start", id, signal, capability.peer, request);
			if (status.kind === "unavailable") return status;
			return observe(id, observer, status);
		},
		recover: (id, observer) => observe(id, observer),
		async cancel(id) {
			const value = await rpc("cancel", id, lifetime.signal);
			if (value.kind !== "canceled")
				throw new Error(
					value.kind === "unavailable"
						? value.reason
						: "Cancellation could not be confirmed; the remote effect may be partial.",
				);
		},
		close() {
			lifetime.abort();
			channel.close();
			persistence.close();
		},
	};
}
