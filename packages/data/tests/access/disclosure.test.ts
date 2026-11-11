// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";

import { fact, list, options, resource, tick } from "../support/scenario.js";

test("newer direct evidence and revoked generation fence late responses", async () => {
	const response = deferred<ObservationBatch>();
	const runtime = createRuntime(
		options(
			resource({
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "status"],
						membership: true,
						run: async () => response.promise,
					},
				],
			}),
		),
	);
	const read = runtime.read(list);
	await tick();
	runtime.observe({ facts: [fact("a", { name: "New" })] });
	response.resolve({ facts: [fact("a", { name: "Old" })] });
	await read;
	assert.equal(runtime.watch(list).getSnapshot().rows[0]?.data.name, "New");
	runtime.revoke("read");
	assert.equal(runtime.watch(list).getSnapshot().rows.length, 0);
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	assert.equal(runtime.watch(list).getSnapshot().rows.length, 0);
	runtime.close();
});

test("losing one disclosure basis keeps independent instance evidence", () => {
	const runtime = createRuntime({
		...options(),
		access: [
			{ scope: "profile", state: "allowed" },
			{ scope: "instance", state: "allowed" },
		],
	});
	runtime.observe({
		facts: [
			{ ...fact("a", { expanded: "value" }), basis: ["profile", "instance"] },
		],
	});
	const watch = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "a",
			select: ["expanded"],
		}),
	);
	runtime.revoke("profile");
	assert.equal(watch.getSnapshot().rows[0]?.data.expanded, "value");
	runtime.revoke("instance");
	assert.equal(watch.getSnapshot().rows.length, 0);
	runtime.close();
});

test("revoking a protected scope keeps independently public facts and owner alive", () => {
	const runtime = createRuntime({
		...options(),
		access: [
			{ scope: "read", state: "allowed" },
			{ scope: "public-image", state: "allowed", contextIndependent: true },
		],
	});
	runtime.observe({
		facts: [
			fact("private", { name: "Private" }),
			{ ...fact("public", { name: "Public" }), basis: ["public-image"] },
		],
	});
	runtime.setAccess({ contextId: "anonymous", decisions: [] });
	const watch = runtime.watch({ ...list, resource: "things" });
	assert.equal(runtime.access("public-image"), "allowed");
	assert.equal(runtime.access("read"), "unknown");
	assert.equal(runtime.accessSnapshot().scopes.read, undefined);
	assert.equal(watch.getSnapshot().rows[0]?.data.name, "Public");
	runtime.revoke("public-image");
	assert.equal(runtime.access("public-image"), "denied");
	runtime.close();
});

test("access retirement recomputes an independently public representation atomically", () => {
	const definition = resource({
		access: () => "public",
		derive: (_changed, context) => {
			const record = context.get("things", "server");
			if (!record) return;
			const field = Object.hasOwn(record.values, "privateConfig")
				? "privateConfig"
				: "publicConfig";
			if (!Object.hasOwn(record.values, field)) return;
			return {
				facts: [
					{
						resource: "things",
						identity: "server",
						values: { config: record.values[field] },
						basis: [field === "privateConfig" ? "read" : "public"],
						dependsOn: [{ resource: "things", identity: "server", field }],
					},
				],
			};
		},
	});
	const runtime = createRuntime(options(definition));
	runtime.observe({
		facts: [
			{
				resource: "things",
				identity: "server",
				presence: "present",
				values: { publicConfig: "public" },
				basis: ["public"],
			},
			fact("server", { privateConfig: "private" }),
		],
	});
	const watch = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "server",
			select: ["config"],
		}),
	);
	assert.equal(watch.getSnapshot().rows[0]?.data.config, "private");
	const seen: unknown[] = [];
	watch.subscribe(() => seen.push(watch.getSnapshot().rows[0]?.data.config));
	runtime.revoke("read");
	assert.deepEqual(seen, ["public"]);
	runtime.close();
});

test("certified output disclosure survives source revocation but truth dependencies still invalidate", () => {
	const runtime = createRuntime({
		...options(),
		access: [
			{ scope: "profile", state: "allowed" },
			{ scope: "instance", state: "allowed" },
		],
	});
	runtime.observe({
		facts: [{ ...fact("profile", { config: "v" }), basis: ["profile"] }],
	});
	runtime.observe({
		facts: [
			{
				resource: "things",
				identity: "instance",
				presence: "present",
				values: { expanded: "v" },
				dependsOn: [
					{ resource: "things", identity: "profile", field: "config" },
				],
				certifiedBasis: ["instance"],
			},
		],
	});
	const watch = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "instance",
			select: ["expanded"],
		}),
	);
	runtime.revoke("profile");
	assert.equal(watch.getSnapshot().rows[0]?.data.expanded, "v");
	runtime.observe({
		invalidate: [{ resource: "things", identity: "profile", field: "config" }],
	});
	assert.equal(watch.getSnapshot().rows[0]?.fields.expanded?.stale, true);
	runtime.close();
});

test("derived disclosure proofs survive cache eviction but remain revocable", () => {
	const runtime = createRuntime({
		...options(resource({ access: () => "public" })),
		maxInactiveRecords: 1,
	});
	runtime.observe({ facts: [fact("source", { value: "private" })] });
	runtime.observe({
		facts: [
			{
				resource: "things",
				identity: "derived",
				presence: "present",
				values: { value: "private" },
				basis: ["public"],
				dependsOn: [{ resource: "things", identity: "source", field: "value" }],
			},
		],
	});
	const watch = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "derived",
			select: ["value"],
		}),
	);
	assert.equal(watch.getSnapshot().rows[0]?.data.value, "private");
	runtime.revoke("read");
	assert.equal(watch.getSnapshot().rows.length, 0);
	runtime.close();
});
