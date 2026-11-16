// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query, stableKey } from "../../src/descriptors.js";
import { idleReadStatus, type Publication } from "../../src/protocol.js";
import {
	emptyReadModel,
	readModelDelta,
} from "../../src/read-model/publication.js";
import { deferred } from "../../src/testing.js";
import type { ResourceDefinition } from "../../src/types.js";
import { channel, host, tick, until } from "../support/browser-client.js";

const detail = (identity = "a") =>
	query({ resource: "things", mode: "one", identity, select: ["name"] });
const list = query({ resource: "things", mode: "list", select: ["name"] });
const fact = (identity: string, name: string) => ({
	resource: "things",
	identity,
	presence: "present" as const,
	values: { name },
	basis: ["read"],
});

test("passive browser queries share evidence with active queries without retaining acquisition demand", async (t) => {
	let reads = 0;
	const definition: ResourceDefinition = {
		name: "things",
		access: () => "read",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				async run(request) {
					reads++;
					return { facts: [fact(String(request.identity), "shared")] };
				},
			},
		],
	};
	const owner = await host(t, definition);
	const a = channel(t, owner.attach, { readDefinitions: [definition] }).client;
	const b = channel(t, owner.attach, { readDefinitions: [definition] }).client;
	const passive = a.watch(detail(), { acquire: false });
	const stop = passive.subscribe(() => {});
	assert.equal(passive.getSnapshot().settled, true);
	await until(
		() =>
			a.connectionSnapshot().phase === "ready" &&
			b.connectionSnapshot().phase === "ready",
	);
	await tick();
	assert.equal(reads, 0);
	assert.equal(passive.getSnapshot().empty, false);
	const active = b.watch(detail());
	const release = active.subscribe(() => {});
	await until(() => passive.getSnapshot().rows[0]?.data.name === "shared");
	assert.equal(reads, 1);
	release();
	owner.runtime.observe({ facts: [fact("a", "updated")] });
	await until(() => passive.getSnapshot().rows[0]?.data.name === "updated");
	assert.equal(reads, 1);
	owner.runtime.revoke("read");
	await until(() => a.access("read") === "denied");
	assert.equal(passive.getSnapshot().rows.length, 0);
	stop();
	assert.equal(
		a.watch(detail(), { acquire: false }).getSnapshot().rows.length,
		0,
	);
});

test("read status follows another tab's active demands and retries only their failed reads", async (t) => {
	let reads = 0;
	const held = deferred<void>();
	const definition: ResourceDefinition = {
		name: "things",
		access: () => "read",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				async run(request) {
					reads++;
					if (reads === 1) {
						await held.promise;
						throw new Error("Source unavailable");
					}
					return { facts: [fact(String(request.identity), "recovered")] };
				},
			},
		],
	};
	const owner = await host(t, definition);
	owner.runtime.observe({ facts: [{ ...fact("a", ""), values: {} }] });
	const a = channel(t, owner.attach, { readDefinitions: [definition] }).client;
	const b = channel(t, owner.attach, { readDefinitions: [definition] }).client;
	const status = a.watchReadStatus(list);
	const irrelevant = a.watchReadStatus(
		query({ resource: "things", mode: "list", select: ["description"] }),
	);
	status.subscribe(() => {});
	irrelevant.subscribe(() => {});
	await until(
		() =>
			a.connectionSnapshot().phase === "ready" &&
			b.connectionSnapshot().phase === "ready",
	);
	await tick();
	assert.equal(reads, 0);
	const active = b.watch(detail());
	const release = active.subscribe(() => {});
	await until(() => status.getSnapshot().pending);
	assert.equal(irrelevant.getSnapshot().pending, false);
	held.resolve();
	await until(() => status.getSnapshot().canRetry);
	assert.equal(status.getSnapshot().issues[0]?.message, "Source unavailable");
	await status.retry();
	await until(
		() =>
			!status.getSnapshot().pending && status.getSnapshot().issues.length === 0,
	);
	assert.equal(reads, 2);
	await until(() => active.getSnapshot().rows[0]?.data.name === "recovered");
	release();
	await tick();
	await status.retry();
	assert.equal(reads, 2);
	status.dispose();
	irrelevant.dispose();
});

test("read status forgets errors after the demand ends and fences late completion after access loss", async (t) => {
	const held = deferred<void>();
	let reads = 0;
	const definition: ResourceDefinition = {
		name: "things",
		access: () => "read",
		sources: [
			{
				key: "detail",
				mode: "one",
				fields: ["name"],
				async run(request) {
					const call = ++reads;
					if (request.identity === "failed")
						throw new Error("Protected failure detail");
					await held.promise;
					return {
						facts: [
							fact(
								"late",
								call === 2 ? "must stay withdrawn" : "fresh generation",
							),
						],
					};
				},
			},
		],
	};
	const owner = await host(t, definition);
	const a = channel(t, owner.attach, { readDefinitions: [definition] }).client;
	const b = channel(t, owner.attach, { readDefinitions: [definition] }).client;
	const status = a.watchReadStatus(list);
	status.subscribe(() => {});
	const failed = b.watch(detail("failed"));
	const release = failed.subscribe(() => {});
	await until(() => status.getSnapshot().canRetry);
	release();
	await until(() => status.getSnapshot().issues.length === 0);
	assert.equal(status.getSnapshot().canRetry, false);
	const passive = a.watch(detail("late"), { acquire: false });
	passive.subscribe(() => {});
	const late = b.watch(detail("late"));
	late.subscribe(() => {});
	await until(() => status.getSnapshot().pending);
	owner.runtime.revoke("read");
	await until(() => a.access("read") === "denied");
	assert.equal(status.getSnapshot().canRetry, false);
	assert.equal(
		status
			.getSnapshot()
			.issues.some((issue) => issue.message === "Protected failure detail"),
		false,
	);
	held.resolve();
	await tick();
	await tick();
	await tick();
	assert.equal(passive.getSnapshot().rows.length, 0);
	assert.equal(reads, 2);
	owner.runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	await until(
		() => passive.getSnapshot().rows[0]?.data.name === "fresh generation",
	);
	assert.equal(
		status
			.getSnapshot()
			.issues.some((issue) => issue.message === "Protected failure detail"),
		false,
	);
	assert.equal(reads, 3);
});

test("publication gaps withdraw read-status details with access changes before resynchronization", async (t) => {
	const { client, peer, messages } = channel(t);
	const status = client.watchReadStatus(list);
	status.subscribe(() => {});
	peer.postMessage({ type: "ready", epoch: "owner" });
	const publish = (
		revision: number,
		access: Publication["access"],
		reset = false,
	): Publication => ({
		type: "publish",
		epoch: "owner",
		base: revision - 1,
		revision,
		reset,
		readModel: readModelDelta(emptyReadModel(), emptyReadModel(), true),
		queries: [],
		readStatuses: [
			{
				id: stableKey(list),
				status: {
					...idleReadStatus,
					issues: [{ kind: "read", message: "Protected failure" }],
					canRetry: true,
				},
			},
		],
		availability: [],
		activities: [],
		access,
		feedback: [],
	});
	peer.postMessage(
		publish(
			1,
			{
				contextId: "alice",
				revision: 1,
				scopes: { read: { state: "allowed", generation: 1 } },
			},
			true,
		),
	);
	await until(() => status.getSnapshot().canRetry);
	peer.postMessage(
		publish(3, {
			contextId: "alice",
			revision: 2,
			scopes: { read: { state: "denied", generation: 2 } },
		}),
	);
	await until(() => client.access("read") === "denied");
	assert.deepEqual(status.getSnapshot(), idleReadStatus);
	await until(() => messages.some((message) => message.type === "snapshot"));
	status.dispose();
});
