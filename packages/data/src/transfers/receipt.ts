// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { TransferReceipt, TransferRecord } from "../transfer-types.js";

export const maxReceiptBodyBytes = 64 * 1024;
export const maxReceiptHeaderBytes = 16 * 1024;
export const maxReceiptMessageBytes = 4096;
const encoder = new TextEncoder();
const states = { prepared: 0, dispatching: 1, accepted: 2 } as const;

function boundedText(
	value: unknown,
	limit: number,
	label: string,
): asserts value is string {
	if (typeof value !== "string") throw new Error(`${label} must be text`);
	if (value.length > limit || encoder.encode(value).byteLength > limit)
		throw new Error(`${label} exceeds the recovery limit`);
}

/** Validate before durable storage, including callers that do not use the response reader. */
export function captureTransferReceipt(
	receipt: TransferReceipt,
): TransferReceipt {
	if (!receipt || typeof receipt !== "object")
		throw new Error("Invalid transfer receipt");
	if (receipt.kind === "unknown") {
		boundedText(
			receipt.message,
			maxReceiptMessageBytes,
			"Transfer receipt message",
		);
		return Object.freeze({ kind: "unknown", message: receipt.message });
	}
	if (receipt.kind !== "response")
		throw new Error("Invalid transfer receipt kind");
	if (
		!Number.isInteger(receipt.status) ||
		receipt.status < 0 ||
		receipt.status > 599 ||
		(receipt.status > 0 && receipt.status < 100)
	)
		throw new Error("Invalid transfer response status");
	boundedText(receipt.body, maxReceiptBodyBytes, "Transfer receipt body");
	if (
		!receipt.headers ||
		typeof receipt.headers !== "object" ||
		Array.isArray(receipt.headers)
	)
		throw new Error("Invalid transfer response headers");
	const headers: [string, string][] = [];
	let size = 2;
	for (const name in receipt.headers) {
		if (!Object.hasOwn(receipt.headers, name)) continue;
		const value = receipt.headers[name];
		boundedText(name, maxReceiptHeaderBytes, "Transfer receipt header name");
		boundedText(value, maxReceiptHeaderBytes, "Transfer receipt header value");
		size +=
			encoder.encode(JSON.stringify(name)).byteLength +
			encoder.encode(JSON.stringify(value)).byteLength +
			1 +
			(headers.length > 0 ? 1 : 0);
		if (size > maxReceiptHeaderBytes)
			throw new Error("Transfer receipt headers exceed the recovery limit");
		headers.push([name, value]);
	}
	return Object.freeze({
		kind: "response",
		status: receipt.status,
		headers: Object.freeze(Object.fromEntries(headers)),
		body: receipt.body,
	});
}

export function captureTransferRecord(record: TransferRecord): TransferRecord {
	if (!record || record.version !== 1 || !Object.hasOwn(states, record.state))
		throw new Error("Invalid transfer recovery record");
	return Object.freeze({
		version: 1,
		state: record.state,
		...(record.admission
			? { admission: structuredClone(record.admission) }
			: {}),
		...(record.receipt !== undefined
			? { receipt: captureTransferReceipt(record.receipt) }
			: {}),
	});
}

/** Later journal snapshots cannot roll back browser handoff or replace response evidence. */
export function mergeTransferRecord(
	previous?: TransferRecord,
	incoming?: TransferRecord,
): TransferRecord | undefined {
	const current = previous && captureTransferRecord(previous);
	const next = incoming && captureTransferRecord(incoming);
	if (!current || !next) return current ?? next;
	const receipt =
		current.receipt?.kind === "response"
			? current.receipt
			: next.receipt?.kind === "response"
				? next.receipt
				: (current.receipt ?? next.receipt);
	return Object.freeze({
		version: 1,
		state:
			states[current.state] >= states[next.state] ? current.state : next.state,
		...((current.admission ?? next.admission)
			? { admission: current.admission ?? next.admission }
			: {}),
		...(receipt ? { receipt } : {}),
	});
}
