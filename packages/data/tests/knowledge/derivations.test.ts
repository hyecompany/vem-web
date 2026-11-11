// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ActionOutcome } from "../../src/types.js";

import { fact, options, resource } from "../support/scenario.js";

test("dependent missing information becomes stale without erasing readable values", () => {
	const runtime = createRuntime(options());
	runtime.observe({ facts: [fact("profile", { config: "old" })] });
	runtime.observe({
		facts: [
			{
				...fact("instance", { expanded: "old" }),
				dependsOn: [
					{ resource: "things", identity: "profile", field: "config" },
				],
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
	runtime.observe({
		invalidate: [{ resource: "things", identity: "profile", field: "config" }],
	});
	assert.equal(watch.getSnapshot().rows[0]?.data.expanded, "old");
	assert.equal(watch.getSnapshot().rows[0]?.fields.expanded?.stale, true);
	runtime.close();
});

test("optimistic source edits derive presentation values without changing confirmed facts", async () => {
	const result = deferred<ActionOutcome>();
	const definition = resource({
		derive: (_changed, context) => {
			const profile = context.get("things", "profile");
			if (!profile?.fields.config) return;
			return {
				facts: [
					{
						resource: "things",
						identity: "instance",
						values: { expanded: profile.values.config },
						basis: ["read"],
						dependsOn: [
							{ resource: "things", identity: "profile", field: "config" },
						],
					},
				],
			};
		},
		commands: {
			edit: {
				access: () => "read",
				disclosure: () => "read",
				project: () => [
					{
						resource: "things",
						identity: "profile",
						kind: "update",
						values: { config: "proposed" },
						basis: ["read"],
					},
				],
				run: () => result.promise,
			},
		},
	});
	const runtime = createRuntime(options(definition));
	runtime.observe({
		facts: [fact("profile", { config: "confirmed" }), fact("instance", {})],
	});
	const watch = runtime.watch(
		query({
			resource: "things",
			mode: "list",
			select: ["expanded"],
			where: { expanded: "proposed" },
		}),
	);
	const action = runtime.run(
		command({ resource: "things", name: "edit", target: "profile", input: {} }),
	);
	assert.equal(watch.getSnapshot().rows[0]?.data.expanded, "proposed");
	assert.equal(
		watch.getSnapshot().rows[0]?.fields.expanded?.source,
		"proposed",
	);
	assert.equal(watch.getSnapshot().confirmed.knownCount, 0);
	result.resolve({
		kind: "failed",
		error: { message: "Rejected" },
		submitted: false,
	});
	await action.result;
	assert.equal(watch.getSnapshot().rows.length, 0);
	runtime.close();
});
