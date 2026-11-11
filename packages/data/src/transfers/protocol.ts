// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { TransferReceipt, TransferRequest } from "../transfer-types.js";

export const transferProtocol = "vem-transfer:1";
export const registrationPrefix = "vem-transfer:1:";
export const registrationId = (id: string) => `${registrationPrefix}${id}`;

export interface TransferMessage {
	protocol: typeof transferProtocol;
	type: "request";
	token: string;
	operation: "probe" | "start" | "accepted" | "status" | "cancel";
	id: string;
	peer?: string;
	request?: TransferRequest;
}
export type TransferStatus =
	| { kind: "unavailable"; reason: string }
	| { kind: "ready"; peer: string }
	| { kind: "claimed" }
	| { kind: "canceled" }
	| {
			kind: "pending";
			accepted: boolean;
			active: boolean;
			completed?: number;
			total?: number;
	  }
	| { kind: "receipt"; receipt: TransferReceipt };
export interface TransferReply {
	protocol: typeof transferProtocol;
	type: "reply";
	token: string;
	value: TransferStatus;
}
export function isTransferMessage(value: unknown): value is TransferMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<TransferMessage>;
	return (
		message.protocol === transferProtocol &&
		message.type === "request" &&
		typeof message.token === "string" &&
		typeof message.id === "string" &&
		message.id.length <= 256 &&
		["probe", "start", "accepted", "status", "cancel"].includes(
			message.operation ?? "",
		)
	);
}
export interface NativeTransfer extends EventTarget {
	id: string;
	uploaded: number;
	uploadTotal: number;
	result: "" | "success" | "failure";
	failureReason: string;
	abort(): Promise<boolean>;
	matchAll(): Promise<{ responseReady: Promise<Response> }[]>;
}
export interface NativeTransferManager {
	fetch(
		id: string,
		requests: Request[],
		options: { title: string },
	): Promise<NativeTransfer>;
	get(id: string): Promise<NativeTransfer | undefined>;
}
export type TransferRegistration = ServiceWorkerRegistration & {
	backgroundFetch?: NativeTransferManager;
};
export const unknownTransfer = (message: string): TransferStatus => ({
	kind: "receipt",
	receipt: { kind: "unknown", message },
});
