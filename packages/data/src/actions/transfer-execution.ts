// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { proofEvery } from "../access-proofs.js";
import type {
	TransferObserver,
	TransferReceipt,
	TransferRequest,
} from "../transfer-types.js";
import { readTransferResponse } from "../transfers/response.js";
import type {
	AccessRequirement,
	ActionContext,
	ActionOutcome,
	DisclosureProof,
} from "../types.js";
import { equal } from "../values.js";
import { type ActionHost, type Entry, errorMessage } from "./entry.js";
import { checkpoint } from "./journal.js";

const unknown = (message: string): TransferReceipt => ({
	kind: "unknown",
	message: message.slice(0, 1024),
});
function requestFor(value: TransferRequest): TransferRequest {
	if (value.body !== undefined && !(value.body instanceof Blob))
		throw new TypeError("A transfer body must be a Blob.");
	const request = new Request(value.url, {
		method: value.method,
		headers: value.headers,
		body: value.body,
		credentials: value.credentials,
	});
	if (!["https:", "http:"].includes(new URL(request.url).protocol))
		throw new TypeError("Transfers require an HTTP or HTTPS URL.");
	return {
		url: request.url,
		method: request.method,
		headers: Object.fromEntries(request.headers),
		body: value.body,
		credentials: request.credentials,
	};
}

function admissionProof(
	requirement: AccessRequirement,
	host: ActionHost,
): DisclosureProof {
	if (typeof requirement === "string")
		return host.access.state(requirement) === "denied"
			? { any: [] }
			: host.access.ref(requirement);
	return "all" in requirement
		? { all: requirement.all.map((part) => admissionProof(part, host)) }
		: { any: requirement.any.map((part) => admissionProof(part, host)) };
}

/** Execute through the existing action; no second registry or replay path is introduced. */
export async function executeTransfer(
	entry: Entry,
	host: ActionHost,
	context: ActionContext,
	publish: (entry: Entry) => void,
	recovery: boolean,
): Promise<ActionOutcome> {
	const definition = entry.definition.transfer;
	if (!definition) throw new Error("A transfer definition is required");
	const current = () => !entry.forgotten && !context.signal.aborted;
	const canSubmit = () =>
		current() &&
		["available", "unknown"].includes(host.availability(entry.command).state) &&
		(!entry.transfer?.admission ||
			(!host.access.revoked(entry.transfer.admission) &&
				proofEvery(
					entry.transfer.admission,
					(ref) =>
						ref.contextId === undefined ||
						ref.contextId === host.access.contextId,
				)));
	let acknowledged = false;
	const accepted = () => {
		if (!current() || acknowledged) return;
		acknowledged = true;
		entry.transfer = { ...entry.transfer, version: 1, state: "accepted" };
		entry.snapshot = { ...entry.snapshot, execution: { lifetime: "browser" } };
		entry.cancelTransfer = host.transfers
			? () => host.transfers?.cancel(entry.snapshot.id) ?? Promise.resolve()
			: undefined;
		context.submitted();
		publish(entry);
		void checkpoint(entry, host, publish);
	};
	const observer: TransferObserver = {
		signal: context.signal,
		canSubmit,
		progress: (progress) => {
			if (current() && !equal(entry.snapshot.progress, progress))
				context.progress(progress);
		},
		accepted,
	};
	let receipt: TransferReceipt | undefined;
	if (recovery) {
		if (entry.transfer?.state === "accepted") accepted();
		if (entry.transfer?.receipt?.kind === "response")
			receipt = entry.transfer.receipt;
		else if (host.transfers && entry.transfer) {
			try {
				receipt = await host.transfers.recover(entry.snapshot.id, observer);
			} catch (error) {
				receipt = unknown(errorMessage(error));
			}
		} else
			receipt = unknown(
				"The previous transfer's remote effect could not be established; it was not resubmitted.",
			);
	} else {
		let request: TransferRequest;
		try {
			request = requestFor(await definition.prepare(entry.command, context));
		} catch (error) {
			return {
				kind: "failed",
				submitted: false,
				error: { message: errorMessage(error) },
			};
		}
		if (!canSubmit())
			return {
				kind: "failed",
				submitted: false,
				error: { message: "Access changed before transfer submission" },
			};
		const requirement =
			typeof entry.definition.access === "function"
				? entry.definition.access(entry.command)
				: entry.definition.access;
		const admission = admissionProof(requirement ?? { all: [] }, host);
		entry.transfer = { version: 1, state: "prepared", admission };
		host.access.register([admission]);
		await checkpoint(entry, host, publish);
		if (!canSubmit())
			return {
				kind: "failed",
				submitted: false,
				error: { message: "Access changed before transfer submission" },
			};
		let fallbackReason = host.transfers
			? "Recovery storage is unavailable; keep this application open until the transfer finishes."
			: "This host does not provide browser-managed transfers; keep this application open until the transfer finishes.";
		if (host.transfers && entry.snapshot.recovery === "saved") {
			try {
				const result = await host.transfers.start(
					entry.snapshot.id,
					request,
					observer,
				);
				if (result.kind !== "unavailable") receipt = result;
				else if (entry.transfer.state === "accepted")
					receipt = unknown(
						"The browser accepted this transfer, but its outcome could not be established.",
					);
				else fallbackReason = result.reason;
			} catch (error) {
				receipt = unknown(errorMessage(error));
			}
		}
		if (!receipt) {
			if (!canSubmit())
				return {
					kind: "failed",
					submitted: false,
					error: { message: "Access changed before transfer submission" },
				};
			entry.snapshot = {
				...entry.snapshot,
				execution: { lifetime: "owner", reason: fallbackReason },
			};
			const controller = new AbortController();
			entry.cancelTransfer = async () => {
				controller.abort(
					new DOMException(
						"The transfer was canceled; its remote effect may be partial.",
						"AbortError",
					),
				);
			};
			publish(entry);
			try {
				const response = await (host.transferFetch ?? globalThis.fetch)(
					request.url,
					{
						method: request.method,
						headers: request.headers,
						body: request.body,
						credentials: request.credentials,
						signal: AbortSignal.any([context.signal, controller.signal]),
					},
				);
				context.submitted();
				receipt = await readTransferResponse(response);
			} catch (error) {
				receipt = unknown(
					`The transfer's remote effect is unknown: ${errorMessage(error)}`,
				);
			}
		}
	}
	if (!current())
		return {
			kind: "unknown",
			message: "Transfer observation ended before the outcome was established",
		};
	entry.transfer = {
		...entry.transfer,
		version: 1,
		state: entry.transfer?.state ?? "prepared",
		receipt,
	};
	await checkpoint(entry, host, publish);
	if (!current())
		return {
			kind: "unknown",
			message: "Transfer observation ended before the outcome was established",
		};
	return receipt.kind === "unknown"
		? receipt
		: definition.complete(receipt, context);
}
