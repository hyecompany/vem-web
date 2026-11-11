// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	isTransferMessage,
	registrationId,
	type TransferMessage,
	type TransferRegistration,
	type TransferStatus,
	transferProtocol,
	unknownTransfer,
} from "./protocol.js";

export interface BackgroundTransferPageOptions {
	/** Same-origin service worker containing installBackgroundTransfers(). */
	serviceWorker: string | URL;
	scope?: string;
	/** Must match the owner and service worker; use one name per application. */
	channel: string;
}

function activeWorker(
	registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
	if (registration.active) return Promise.resolve(registration.active);
	const worker = registration.installing ?? registration.waiting;
	if (!worker)
		return Promise.reject(
			new Error("The transfer service worker is unavailable."),
		);
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			worker.removeEventListener("statechange", changed);
		};
		const changed = () => {
			if (worker.state === "activated") {
				cleanup();
				resolve(worker);
			} else if (worker.state === "redundant") {
				cleanup();
				reject(new Error("The transfer service worker was replaced."));
			}
		};
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("The transfer service worker did not activate."));
		}, 30_000);
		worker.addEventListener("statechange", changed);
		changed();
	});
}

/** Bridge the shared owner to browser-managed transfers; call once in the application host. */
export function attachBackgroundTransfers(
	options: BackgroundTransferPageOptions,
): () => void {
	const channel = new BroadcastChannel(options.channel);
	const peer = crypto.randomUUID();
	let closed = false;
	let registration: Promise<TransferRegistration> | undefined;
	const supported =
		typeof navigator !== "undefined" &&
		"serviceWorker" in navigator &&
		typeof ServiceWorkerRegistration !== "undefined" &&
		"backgroundFetch" in ServiceWorkerRegistration.prototype;
	const getRegistration = () =>
		(registration ??= navigator.serviceWorker
			.register(options.serviceWorker, {
				type: "module",
				scope: options.scope,
				updateViaCache: "none",
			})
			.then((value) => value as TransferRegistration)
			.catch((error) => {
				registration = undefined;
				throw error;
			}));
	async function handle(message: TransferMessage): Promise<TransferStatus> {
		if (!supported)
			return {
				kind: "unavailable",
				reason:
					"This browser requires an application tab to remain open during transfers.",
			};
		if (message.operation === "probe" || message.operation === "start") {
			try {
				const permission = await navigator.permissions.query({
					name: "background-fetch" as PermissionName,
				});
				if (permission.state === "denied")
					return {
						kind: "unavailable",
						reason:
							"Background transfers are not permitted; keep an application tab open.",
					};
			} catch {
				/* Unsupported permission names do not establish denial. */
			}
		}
		const registered = await getRegistration();
		const worker = await activeWorker(registered);
		if (closed) throw new Error("Transfer bridge closed.");
		if (message.operation === "probe") {
			if (!registered.backgroundFetch)
				return {
					kind: "unavailable",
					reason: "Browser-managed transfers are unavailable.",
				};
			return { kind: "ready", peer };
		}
		const send = (request: TransferMessage) =>
			new Promise<TransferStatus>((resolve, reject) => {
				const ports = new MessageChannel();
				const cleanup = () => {
					clearTimeout(timeout);
					ports.port1.close();
				};
				const timeout = setTimeout(() => {
					cleanup();
					reject(new Error("The transfer acknowledgement was not received."));
				}, 30_000);
				ports.port1.onmessage = (event: MessageEvent<TransferStatus>) => {
					cleanup();
					resolve(event.data);
				};
				ports.port1.onmessageerror = () => {
					cleanup();
					reject(new Error("Unreadable transfer acknowledgement."));
				};
				try {
					worker.postMessage(request, [ports.port2]);
				} catch (error) {
					cleanup();
					reject(error);
				}
			});
		const status = await send(message);
		if (status.kind !== "claimed") return status;
		if (!message.request || !registered.backgroundFetch || closed)
			return unknownTransfer(
				"The transfer host closed before browser acceptance; the request was not repeated.",
			);
		const input = message.request;
		try {
			const native = await registered.backgroundFetch.fetch(
				registrationId(message.id),
				[
					new Request(input.url, {
						method: input.method,
						headers: input.headers,
						body: input.body,
						credentials: input.credentials ?? "same-origin",
						redirect: "error",
						cache: "no-store",
					}),
				],
				{ title: "File transfer" },
			);
			await send({ ...message, operation: "accepted", request: undefined });
			return {
				kind: "pending",
				accepted: true,
				active: true,
				completed: native.uploaded,
				total: native.uploadTotal,
			};
		} catch (error) {
			return unknownTransfer(
				`Browser transfer submission could not be established; the request was not repeated. ${error instanceof Error ? error.message.slice(0, 512) : ""}`,
			);
		}
	}
	channel.onmessage = (event: MessageEvent<unknown>) => {
		const message = event.data;
		if (!isTransferMessage(message) || (message.peer && message.peer !== peer))
			return;
		void handle(message)
			.catch(
				(): TransferStatus =>
					message.operation === "probe"
						? {
								kind: "unavailable",
								reason:
									"Browser continuation could not be established; keep an application tab open.",
							}
						: unknownTransfer(
								"The browser transfer acknowledgement was lost; the request was not repeated.",
							),
			)
			.then((value) => {
				if (!closed)
					channel.postMessage({
						protocol: transferProtocol,
						type: "reply",
						token: message.token,
						value,
					});
			});
	};
	return () => {
		closed = true;
		channel.close();
	};
}
