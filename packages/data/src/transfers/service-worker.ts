// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { DexiePersistence } from "../persistence.js";
import type { TransferReceipt, TransferRequest } from "../transfer-types.js";
import {
	isTransferMessage,
	type NativeTransfer,
	registrationId,
	registrationPrefix,
	type TransferMessage,
	type TransferRegistration,
	type TransferStatus,
	transferProtocol,
	unknownTransfer,
} from "./protocol.js";
import { readTransferResponse } from "./response.js";

interface WorkerEvent extends Event {
	waitUntil(work: Promise<unknown>): void;
}
interface TransferEvent extends WorkerEvent {
	registration: NativeTransfer;
}
interface TransferMessageEvent extends WorkerEvent {
	data: unknown;
	ports: readonly MessagePort[];
	source: { url?: string } | null;
}
interface TransferWorker extends EventTarget {
	registration: TransferRegistration;
	location: Location;
}
export interface BackgroundTransferWorkerOptions {
	/** The owner's existing Dexie database; receipts inherit the action's disclosure grants. */
	databaseName: string;
	/** Must match the owner and page bridge. */
	channel: string;
}

function requestForTransfer(input: TransferRequest): Request {
	const url = new URL(input.url);
	if (!["http:", "https:"].includes(url.protocol))
		throw new Error("An HTTP transfer URL is required.");
	if (!["POST", "PUT", "PATCH"].includes(input.method.toUpperCase()))
		throw new Error("An upload method is required.");
	if (input.body !== undefined && !(input.body instanceof Blob))
		throw new Error("A Blob upload body is required.");
	return new Request(url, {
		method: input.method,
		headers: input.headers,
		body: input.body,
		credentials: input.credentials ?? "same-origin",
		redirect: "error",
		cache: "no-store",
	});
}

/** Install transport-only handlers in an application's service worker, without taking over caching or ownership. */
export function installBackgroundTransfers(
	options: BackgroundTransferWorkerOptions,
): void {
	const scope = globalThis as unknown as TransferWorker;
	const notify = () => {
		const channel = new BroadcastChannel(options.channel);
		channel.postMessage({ protocol: transferProtocol, type: "changed" });
		channel.close();
	};
	const withStorage = async <T>(
		work: (storage: DexiePersistence) => Promise<T>,
	): Promise<T> => {
		const storage = new DexiePersistence(options.databaseName);
		try {
			return await work(storage);
		} finally {
			storage.close();
		}
	};
	const status = async (
		id: string,
		storage: DexiePersistence,
	): Promise<TransferStatus> => {
		const record = await storage.readTransfer(id);
		if (!record)
			return unknownTransfer("The protected transfer record is unavailable.");
		if (record.receipt?.kind === "response")
			return { kind: "receipt", receipt: record.receipt };
		const registration = await scope.registration.backgroundFetch?.get(
			registrationId(id),
		);
		const latest = await storage.readTransfer(id);
		if (!latest)
			return unknownTransfer("The protected transfer record was withdrawn.");
		if (latest.receipt && (latest.receipt.kind === "response" || !registration))
			return { kind: "receipt", receipt: latest.receipt };
		return {
			kind: "pending",
			accepted: Boolean(registration) || latest.state === "accepted",
			active: Boolean(registration),
			completed: registration?.uploaded,
			total: registration?.uploadTotal,
		};
	};
	const handle = async (message: TransferMessage): Promise<TransferStatus> => {
		if (message.operation === "probe")
			return {
				kind: "unavailable",
				reason: "Probe the application page host first.",
			};
		const manager = scope.registration.backgroundFetch;
		if (!manager)
			return {
				kind: "unavailable",
				reason: "Browser-managed transfers are not supported.",
			};
		return withStorage(async (storage) => {
			if (message.operation === "status") return status(message.id, storage);
			if (message.operation === "cancel") {
				if (!(await storage.readTransfer(message.id)))
					return unknownTransfer("This transfer is no longer available.");
				const registration = await manager.get(registrationId(message.id));
				return registration && (await registration.abort())
					? { kind: "canceled" }
					: unknownTransfer(
							"The browser did not confirm cancellation; the transfer may already have finished.",
						);
			}
			if (message.operation === "accepted") {
				await storage.recordTransfer(message.id, { state: "accepted" });
				notify();
				return status(message.id, storage);
			}
			if (!message.request)
				return unknownTransfer("No transfer request was supplied.");
			try {
				requestForTransfer(message.request);
			} catch {
				return {
					kind: "unavailable",
					reason: "The request cannot use browser-managed execution.",
				};
			}
			let claimed: boolean;
			try {
				claimed = await storage.claimTransfer(message.id);
			} catch {
				return {
					kind: "unavailable",
					reason:
						"Durable transfer storage is unavailable; keep an application tab open.",
				};
			}
			return claimed ? { kind: "claimed" } : status(message.id, storage);
		});
	};
	scope.addEventListener("message", ((event: TransferMessageEvent) => {
		if (!isTransferMessage(event.data) || !event.ports[0] || !event.source?.url)
			return;
		if (new URL(event.source.url).origin !== scope.location.origin) return;
		const port = event.ports[0];
		const message = event.data;
		event.waitUntil(
			handle(message)
				.catch(() =>
					unknownTransfer(
						"The transfer could not be observed; the request was not repeated.",
					),
				)
				.then((value) => {
					port.postMessage(value);
					port.close();
				}),
		);
	}) as EventListener);
	const completed = (event: TransferEvent) => {
		if (!event.registration.id.startsWith(registrationPrefix)) return;
		const id = event.registration.id.slice(registrationPrefix.length);
		event.waitUntil(
			withStorage(async (storage) => {
				if (!(await storage.readTransfer(id))) return;
				let receipt: TransferReceipt;
				try {
					const records = await event.registration.matchAll();
					const response =
						records.length === 1 ? await records[0]?.responseReady : undefined;
					receipt = response
						? await readTransferResponse(response)
						: {
								kind: "unknown",
								message:
									"No complete transfer response was available; the destination may contain partial data.",
							};
				} catch {
					receipt = {
						kind: "unknown",
						message:
							"The transfer stopped without a complete response; the destination may contain partial data.",
					};
				}
				await storage.recordTransfer(id, { state: "accepted", receipt });
				notify();
			}),
		);
	};
	for (const type of [
		"backgroundfetchsuccess",
		"backgroundfetchfail",
		"backgroundfetchabort",
	])
		scope.addEventListener(type, completed as EventListener);
}
