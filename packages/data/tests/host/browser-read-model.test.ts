// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { BrowserClient, protocolVersion } from "../../src/client.js";
import { query } from "../../src/descriptors.js";
import type { Publication } from "../../src/protocol.js";
import {
	applyReadModel,
	emptyReadModel,
	readModelDelta,
} from "../../src/read-model/publication.js";
import { createRuntime } from "../../src/runtime.js";
import type { QueryDescriptor, ResourceDefinition } from "../../src/types.js";

const continuity = { channel: "test-events" };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const compatibility = {
	protocol: protocolVersion,
	schema: 1,
	definitions: 1,
	build: "test",
};
const scope = { project: "default" };
const a = { project: "default", name: "a" };
const b = { project: "default", name: "b" };

async function mirror(t: TestContext) {
	let acquisitions = 0;
	const definitions: ResourceDefinition[] = [
		{
			name: "things",
			key: (identity) => (identity as typeof a).name,
			inScope: (identity, selected) =>
				(identity as typeof a).project === (selected as typeof scope).project,
			access: () => "read",
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name", "status", "description"],
					membership: true,
					run: async () => {
						acquisitions++;
					},
				},
			],
		},
		{
			name: "other",
			sources: [
				{
					key: "collection",
					mode: "list",
					fields: ["name"],
					membership: true,
					run: async () => {
						acquisitions++;
					},
				},
			],
		},
	];
	const runtime = createRuntime({
		resources: definitions,
		contextId: "alice",
		access: [{ scope: "read", state: "allowed" }],
	});
	await runtime.ready;
	runtime.observe({
		facts: [a, b].map((identity) => ({
			liveness: continuity,
			resource: "things",
			identity,
			presence: "present" as const,
			values: {
				name: identity.name,
				status: "Stopped",
				description: `description-${identity.name}`,
				label: `public-${identity.name}`,
			},
			basis: ["public"],
			fieldBasis: { status: ["read"], description: ["read"] },
		})),
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				scope,
				identities: [a, b],
				complete: true,
				basis: ["public"],
			},
		],
	});
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "other",
				identity: "extracted",
				presence: "present",
				values: { title: "already extracted" },
				basis: ["public"],
			},
		],
	});
	const pair = new MessageChannel();
	const client = new BrowserClient(pair.port1, compatibility, {
		readDefinitions: definitions,
		maxInactiveQueries: 0,
	});
	const messages: { type: string }[] = [];
	pair.port2.addEventListener("message", (event) => messages.push(event.data));
	pair.port2.start();
	pair.port2.postMessage({ type: "ready", compatibility });
	let previous = emptyReadModel();
	let revision = 0;
	const publish = async (reset = false) => {
		const next = runtime.readModelSnapshot();
		const publication: Publication = {
			type: "publish",
			epoch: "owner",
			base: revision,
			revision: ++revision,
			reset,
			readModel: readModelDelta(previous, next, reset),
			queries: [],
			availability: [],
			activities: runtime.listActivities(),
			access: runtime.accessSnapshot(),
			feedback: [],
		};
		previous = next;
		pair.port2.postMessage(publication);
		await tick();
		await tick();
	};
	await publish(true);
	t.after(() => {
		client.close();
		pair.port2.close();
		runtime.close();
	});
	return {
		client,
		runtime,
		publish,
		messages,
		acquisitions: () => acquisitions,
	};
}

test("unseen filters, selected fields, details and resources synchronously project disclosed owner knowledge", async (t) => {
	const { client, runtime, messages, acquisitions } = await mirror(t);
	const descriptions = [
		query({
			resource: "things",
			mode: "list",
			scope,
			select: ["name", "status"],
			where: { status: "Running" },
		}),
		query({
			resource: "things",
			mode: "list",
			scope,
			select: ["description"],
			orderBy: [{ field: "name", direction: "desc" }],
		}),
		query({
			resource: "things",
			mode: "one",
			identity: a,
			select: ["description", "status"],
		}),
		query({
			resource: "other",
			mode: "one",
			identity: "extracted",
			select: ["title"],
		}),
	] as const satisfies readonly QueryDescriptor[];
	for (const description of descriptions) {
		const browser = client.watch(description);
		const owner = runtime.watch(description);
		assert.deepEqual(browser.getSnapshot(), owner.getSnapshot());
		assert.equal(browser.getSnapshot(), browser.getSnapshot());
		assert.equal(browser.getSnapshot().settled, true);
		owner.dispose();
	}
	const filtered = client.watch(descriptions[0]).getSnapshot();
	assert.equal(filtered.empty, true);
	assert.equal(filtered.confirmed.total, 0);
	assert.equal(
		client.watch(descriptions[1]).getSnapshot().rows[0]?.data.description,
		"description-b",
	);
	assert.equal(
		client.watch(descriptions[3]).getSnapshot().rows[0]?.data.title,
		"already extracted",
	);
	await tick();
	assert.equal(
		messages.some(
			(message) => message.type === "watch" || message.type === "read",
		),
		false,
	);
	assert.equal(acquisitions(), 0);
});

test("unseen incomplete selections retain rows and unknown filters never become proven empty", async (t) => {
	const { client, runtime } = await mirror(t);
	const selected = query({
		resource: "things",
		mode: "list",
		scope,
		select: ["name", "notAcquired"],
	});
	const value = client.watch(selected).getSnapshot();
	assert.equal(value.rows.length, 2);
	assert.equal(value.rows[0]?.complete, false);
	assert.deepEqual(value.rows[0]?.missing, ["notAcquired"]);
	assert.equal(value.confirmed.total, 2);
	assert.equal(value.settled, false);
	const unknown = query({
		resource: "things",
		mode: "list",
		scope,
		select: ["name"],
		where: { notAcquired: true },
	});
	const filtered = client.watch(unknown).getSnapshot();
	assert.equal(filtered.rows.length, 0);
	assert.equal(filtered.unresolved.length, 2);
	assert.equal(filtered.empty, false);
	assert.equal(filtered.confirmed.complete, false);
	assert.deepEqual(filtered, runtime.watch(unknown).getSnapshot());
});

test("unsubscribed and never-subscribed descriptions follow selective disclosure and coverage changes", async (t) => {
	const { client, runtime, publish } = await mirror(t);
	const selected = query({
		resource: "things",
		mode: "list",
		scope,
		select: ["name", "description", "label"],
	});
	const view = client.watch(selected);
	assert.equal(view.getSnapshot().rows[0]?.data.description, "description-a");
	runtime.revoke("read");
	await publish(true);
	assert.equal(view.getSnapshot().rows[0]?.data.description, undefined);
	assert.equal(view.getSnapshot().rows[0]?.data.label, "public-a");
	assert.deepEqual(view.getSnapshot(), runtime.watch(selected).getSnapshot());
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	await publish(true);
	assert.equal(
		client.watch(selected).getSnapshot().rows[0]?.data.description,
		undefined,
	);
	runtime.setContinuity(continuity, "interrupted");
	await publish();
	const newFilter = query({
		resource: "things",
		mode: "list",
		scope,
		select: ["name"],
		where: { status: "Running" },
	});
	assert.equal(client.watch(newFilter).getSnapshot().empty, false);
	assert.equal(client.watch(newFilter).getSnapshot().confirmed.complete, false);
	assert.deepEqual(
		client.watch(newFilter).getSnapshot(),
		runtime.watch(newFilter).getSnapshot(),
	);
});

test("unchanged model publications preserve table and snapshot identity", async (t) => {
	const { runtime } = await mirror(t);
	const snapshot = runtime.readModelSnapshot();
	const noChange = readModelDelta(snapshot, snapshot, false);
	assert.deepEqual(noChange.records, { upsert: [], remove: [] });
	assert.deepEqual(noChange.memberships, { upsert: [], remove: [] });
	assert.equal(applyReadModel(snapshot, noChange, false), snapshot);
	runtime.observe({
		facts: [
			{
				liveness: continuity,
				resource: "other",
				identity: "extracted",
				values: { title: "changed" },
				basis: ["public"],
			},
		],
	});
	const next = runtime.readModelSnapshot();
	const delta = readModelDelta(snapshot, next, false);
	assert.equal(delta.records.upsert.length, 1);
	const applied = applyReadModel(snapshot, delta, false);
	assert.equal(applied.memberships, snapshot.memberships);
	assert.deepEqual(applied, next);
});
