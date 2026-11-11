// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, type EditDescriptor, query } from "@hyecompany/vem-data";
import {
	createRuntime,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const descriptor: EditDescriptor = {
	kind: "edit",
	resource: "tasks",
	name: "notes",
	target: "a",
};
const detail = query({
	resource: "tasks",
	mode: "one",
	identity: "a",
	select: ["title"],
});
const writable = query({
	resource: "tasks",
	mode: "one",
	identity: "a",
	select: ["$writable"],
});
const response = (notes: string, etag: string) => ({
	facts: [
		{
			resource: "tasks",
			identity: "a",
			presence: "present" as const,
			values: { title: "A", $writable: { values: { notes }, etag } },
			basis: ["read"],
		},
	],
});
const domain = (
	run: NonNullable<ResourceDefinition["sources"]>[number]["run"],
	prepared: () => void = () => undefined,
): ResourceDefinition => ({
	name: "tasks",
	access: () => "read",
	sources: [
		{ key: "detail", mode: "one", fields: ["title", "$writable"], run },
	],
	edits: {
		notes: {
			readPrerequisites: () => [writable],
			prepare: async (edit, context) => {
				prepared();
				const snapshot = context.get("tasks", "a")?.values.$writable as {
					values: { notes: string };
					etag: string;
				};
				return {
					descriptor: edit,
					values: snapshot.values,
					etag: snapshot.etag,
					baseline: snapshot,
					disclosure: "public",
					fieldDisclosure: { notes: "read" },
					writeAccess: "write",
				};
			},
			command: (prepared) =>
				command({
					resource: "tasks",
					name: "save",
					target: "a",
					input: { etag: prepared.etag },
				}),
		},
	},
});
const options = (resource: ResourceDefinition) => ({
	resources: [resource],
	maxConcurrent: 1,
	contextId: "alice",
	access: [{ scope: "read", state: "allowed" as const }],
});

test("two editor baselines join a detail source with one acquisition slot and preserve its atomic ETag", {
	timeout: 5000,
}, async (t) => {
	const pending = deferred<void>();
	let reads = 0,
		prepares = 0;
	const runtime = createRuntime(
		options(
			domain(
				async () => {
					reads++;
					await pending.promise;
					return response("First", "etag-1");
				},
				() => prepares++,
			),
		),
	);
	t.after(() => runtime.close());
	const ordinary = runtime.read(detail);
	await tick();
	const first = runtime.prepareEdit(descriptor),
		second = runtime.prepareEdit(descriptor);
	await tick();
	assert.equal(reads, 1);
	pending.resolve();
	const [, a, b] = await Promise.all([ordinary, first, second]);
	assert.equal(reads, 1);
	assert.equal(prepares, 2);
	assert.deepEqual(a.values, { notes: "First" });
	assert.deepEqual(b.values, a.values);
	assert.equal(a.etag, "etag-1");
	assert.equal(b.etag, "etag-1");
	runtime.observe(response("Second", "etag-2"));
	const fresh = await runtime.prepareEdit(descriptor);
	assert.deepEqual(fresh.values, { notes: "Second" });
	assert.equal(fresh.etag, "etag-2");
	assert.equal(reads, 1);
});

test("partial, failed and denied edit prerequisites never invoke baseline mapping", async (t) => {
	for (const kind of ["partial", "failed", "denied"] as const) {
		let prepares = 0,
			reads = 0;
		const runtime = createRuntime(
			options(
				domain(
					async () => {
						reads++;
						if (kind === "failed") throw new Error("Service unavailable");
						return {
							facts: [
								{
									resource: "tasks",
									identity: "a",
									presence: "present",
									values: { title: "A" },
									basis: ["read"],
								},
							],
						};
					},
					() => prepares++,
				),
			),
		);
		t.after(() => runtime.close());
		if (kind === "denied") runtime.revoke("read");
		await assert.rejects(
			runtime.prepareEdit(descriptor),
			kind === "failed"
				? /Service unavailable/
				: kind === "denied"
					? /access/i
					: /information|source/i,
		);
		assert.equal(prepares, 0);
		assert.equal(reads, kind === "denied" ? 0 : 1);
	}
});

test("editor prerequisites cannot cross a retired authority or permission generation", {
	timeout: 5000,
}, async (t) => {
	for (const change of ["context", "permission"] as const) {
		const pending = deferred<void>();
		let reads = 0;
		const runtime = createRuntime(
			options(
				domain(async () => {
					reads++;
					if (reads === 1) await pending.promise;
					return response("Protected", "etag");
				}),
			),
		);
		t.after(() => runtime.close());
		const preparation = runtime.prepareEdit(descriptor);
		const rejected = assert.rejects(preparation, /access|Access/);
		await tick();
		if (change === "context")
			runtime.setAccess({
				contextId: "bob",
				decisions: [{ scope: "read", state: "allowed" }],
			});
		else {
			runtime.revoke("read");
			runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
		}
		pending.resolve();
		await rejected;
	}
});

test("explicit edit reload retries a previous failure once and concurrent reloads share that attempt", {
	timeout: 5000,
}, async (t) => {
	let reads = 0;
	const runtime = createRuntime(
		options(
			domain(async () => {
				reads++;
				if (reads === 1) throw new Error("Offline");
				return response("Recovered", "etag-recovered");
			}),
		),
	);
	t.after(() => runtime.close());
	await assert.rejects(runtime.prepareEdit(descriptor), /Offline/);
	assert.equal(reads, 1);
	const [first, second] = await Promise.all([
		runtime.prepareEdit(descriptor),
		runtime.prepareEdit(descriptor),
	]);
	assert.equal(reads, 2);
	assert.equal(first.values.notes, "Recovered");
	assert.equal(second.etag, "etag-recovered");
});

test("a forbidden writable field blocks edit prerequisites before acquiring otherwise readable presence", async (t) => {
	let reads = 0,
		prepares = 0;
	const resource = domain(
		async () => {
			reads++;
			return response("Protected", "etag");
		},
		() => prepares++,
	);
	resource.access = "public";
	resource.fieldAccess = { $writable: "snapshot:read" };
	resource.sources = [
		{
			key: "list",
			mode: "list",
			membership: true,
			fields: ["title"],
			run: async () => {
				reads++;
				return {
					memberships: [
						{
							resource: "tasks",
							identities: ["a"],
							complete: true,
							basis: ["public"],
						},
					],
				};
			},
		},
		...(resource.sources ?? []),
	];
	const runtime = createRuntime(options(resource));
	t.after(() => runtime.close());
	runtime.setAccess({
		decisions: [{ scope: "snapshot:read", state: "denied" }],
	});
	await assert.rejects(runtime.prepareEdit(descriptor), /access/i);
	assert.equal(reads, 0);
	assert.equal(prepares, 0);
});
