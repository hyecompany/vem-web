// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { TransferReceipt } from "../transfer-types.js";

import { maxReceiptBodyBytes, maxReceiptHeaderBytes } from "./receipt.js";

/** Capture bounded transport evidence; HTTP status alone does not establish domain success. */
export async function readTransferResponse(
	response: Response,
): Promise<TransferReceipt> {
	const headers = Object.fromEntries(response.headers);
	const encoder = new TextEncoder();
	if (
		encoder.encode(JSON.stringify(headers)).byteLength > maxReceiptHeaderBytes
	)
		return {
			kind: "unknown",
			message: "The transfer response headers exceeded the recovery limit.",
		};
	const reader = response.body?.getReader();
	let size = 0;
	let body = "";
	const decoder = new TextDecoder();
	try {
		if (reader) {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				size += chunk.value.byteLength;
				if (size > maxReceiptBodyBytes) {
					await reader.cancel();
					return {
						kind: "unknown",
						message: "The transfer response exceeded the recovery limit.",
					};
				}
				body += decoder.decode(chunk.value, { stream: true });
			}
			body += decoder.decode();
			if (encoder.encode(body).byteLength > maxReceiptBodyBytes)
				return {
					kind: "unknown",
					message: "The decoded transfer response exceeded the recovery limit.",
				};
		}
		return { kind: "response", status: response.status, headers, body };
	} catch {
		return {
			kind: "unknown",
			message: "The transfer response could not be read completely.",
		};
	} finally {
		reader?.releaseLock();
	}
}
