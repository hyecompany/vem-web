// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { createRuntime, DexiePersistence } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import { createBackgroundTransfers } from "../../src/transfers/background.js";
import { attachBackgroundTransfers } from "../../src/transfers/page.js";
import {
	type TransferMessage,
	type TransferStatus,
	transferProtocol,
	unknownTransfer,
} from "../../src/transfers/protocol.js";
import { options } from "../support/scenario.js";
import { response, transferResource, upload } from "../support/transfers.js";

function host(
	t: TestContext,
	respond: (
		request: TransferMessage,
	) => TransferStatus | undefined | Promise<TransferStatus | undefined>,
) {
	const name = `transfer-host-${crypto.randomUUID()}`;
	const channel = new BroadcastChannel(name);
	const transfers = createBackgroundTransfers({
		databaseName: name,
		channel: name,
	});
	const storage = new DexiePersistence(name);
	const calls: string[] = [];
	channel.onmessage = (event: MessageEvent<TransferMessage>) => {
		if (event.data.type !== "request") return;
		calls.push(event.data.operation);
		void Promise.resolve(respond(event.data)).then((value) => {
			if (value)
				channel.postMessage({
					protocol: transferProtocol,
					type: "reply",
					token: event.data.token,
					value,
				});
		});
	};
	t.after(() => {
		transfers.close();
		channel.close();
		storage.close();
	});
	return { name, transfers, storage, calls };
}

test("an unavailable browser probe admits exactly one owner-bound attempt", async (t) => {
	const fixture = host(t, () => ({
		kind: "unavailable",
		reason: "Browser continuation is unsupported",
	}));
	let fetched = 0;
	const runtime = createRuntime({
		...options(transferResource()),
		persistence: fixture.storage,
		transfers: fixture.transfers,
		transferFetch: async () => {
			fetched++;
			return new Response("ok");
		},
	});
	t.after(() => runtime.close());
	await runtime.ready;
	const action = runtime.run(upload);
	assert.equal((await action.result).kind, "succeeded");
	assert.deepEqual(fixture.calls, ["probe"]);
	assert.equal(fetched, 1);
	assert.equal(action.getSnapshot().execution?.lifetime, "owner");
});

test("the provider rechecks write admission after probing before sending a handoff", async (t) => {
	let withdraw!: () => void;
	const fixture = host(t, () => {
		withdraw();
		return { kind: "ready", peer: "page" };
	});
	let fetched = 0;
	const runtime = createRuntime({
		...options(transferResource({}, { access: "write" })),
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "write", state: "allowed" },
		],
		persistence: fixture.storage,
		transfers: fixture.transfers,
		transferFetch: async () => {
			fetched++;
			return new Response();
		},
	});
	t.after(() => runtime.close());
	withdraw = () => runtime.revoke("write");
	await runtime.ready;
	const outcome = await runtime.run(upload).result;
	assert.equal(outcome.kind, "failed");
	if (outcome.kind === "failed") assert.equal(outcome.submitted, false);
	assert.deepEqual(fixture.calls, ["probe"]);
	assert.equal(fetched, 0);
});

test("a lost handoff acknowledgement remains uncertain without replay or fallback", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const sent = deferred<void>();
	const fixture = host(t, async (request) => {
		if (request.operation === "probe") return { kind: "ready", peer: "page" };
		assert.equal(request.operation, "start");
		assert.equal(await fixture.storage.claimTransfer(request.id), true);
		await fixture.storage.recordTransfer(request.id, { state: "accepted" });
		sent.resolve();
		return undefined;
	});
	let fetched = 0;
	const runtime = createRuntime({
		...options(transferResource()),
		persistence: fixture.storage,
		transfers: fixture.transfers,
		transferFetch: async () => {
			fetched++;
			return new Response();
		},
	});
	t.after(() => runtime.close());
	await runtime.ready;
	const action = runtime.run(upload);
	await sent.promise;
	t.mock.timers.tick(35_000);
	assert.equal((await action.result).kind, "unknown");
	assert.equal(action.getSnapshot().execution?.lifetime, "browser");
	assert.deepEqual(fixture.calls, ["probe", "start"]);
	assert.equal(fetched, 0);
});

test("cancel resolves only after an explicit browser cancellation acknowledgement", async (t) => {
	let reply: TransferStatus = unknownTransfer(
		"Cancellation acknowledgement was lost",
	);
	const fixture = host(t, () => reply);
	await assert.rejects(
		fixture.transfers.cancel("action"),
		/cancel|acknowledg|unknown/i,
	);
	reply = { kind: "receipt", receipt: response };
	await assert.rejects(fixture.transfers.cancel("action"));
	reply = { kind: "pending", active: true, accepted: true };
	await assert.rejects(fixture.transfers.cancel("action"));
	reply = { kind: "canceled" };
	await fixture.transfers.cancel("action");
});

test("known browser permission denial is reported before a native handoff", async (t) => {
	const navigatorDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"navigator",
	);
	const registrationDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"ServiceWorkerRegistration",
	);
	class Registration {
		backgroundFetch = {
			fetch: () => {
				throw new Error("Denied permission must never dispatch");
			},
		};
		active = {
			postMessage: () => {
				throw new Error("Probe must not claim work");
			},
		};
	}
	Object.defineProperty(Registration.prototype, "backgroundFetch", {
		value: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "ServiceWorkerRegistration", {
		configurable: true,
		value: Registration,
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			serviceWorker: { register: async () => new Registration() },
			permissions: {
				query: async (permission: { name: string }) => {
					assert.equal(permission.name, "background-fetch");
					return { state: "denied" };
				},
			},
		},
	});
	t.after(() => {
		if (navigatorDescriptor)
			Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
		else Reflect.deleteProperty(globalThis, "navigator");
		if (registrationDescriptor)
			Object.defineProperty(
				globalThis,
				"ServiceWorkerRegistration",
				registrationDescriptor,
			);
		else Reflect.deleteProperty(globalThis, "ServiceWorkerRegistration");
	});
	const name = `permission-probe-${crypto.randomUUID()}`;
	const close = attachBackgroundTransfers({
		serviceWorker: "https://example.test/worker.js",
		channel: name,
	});
	const channel = new BroadcastChannel(name);
	t.after(() => {
		close();
		channel.close();
	});
	const replied = deferred<TransferStatus>();
	channel.onmessage = (event: MessageEvent<{ value: TransferStatus }>) =>
		replied.resolve(event.data.value);
	channel.postMessage({
		protocol: transferProtocol,
		type: "request",
		token: "probe",
		operation: "probe",
		id: "action",
	});
	const status = await replied.promise;
	assert.equal(status.kind, "unavailable");
});
