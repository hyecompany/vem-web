// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";

import { options, resource, tick } from "../support/scenario.js";

test("a protected edit baseline cannot cross owner epochs with coincident counters", async () => {
	const definition = resource({
		edits: {
			edit: {
				prepare: async (descriptor) => ({
					descriptor,
					values: { name: "A" },
					etag: "etag",
					baseline: {},
					disclosure: "public",
					fieldDisclosure: { name: "read" },
					writeAccess: "write",
				}),
				command: () => command({ resource: "things", name: "save", input: {} }),
			},
		},
		commands: {
			save: {
				access: () => "write",
				disclosure: () => "write",
				run: async () => ({ kind: "succeeded" }),
			},
		},
	});
	const first = createRuntime(options(definition));
	const prepared = await first.prepareEdit({
		kind: "edit",
		resource: "things",
		name: "edit",
		target: "a",
	});
	first.close();
	const second = createRuntime(options(definition));
	assert.throws(
		() => second.saveEdit(prepared, { name: "B" }),
		/previous runtime owner/,
	);
	second.close();
});

test("an edit response cannot adopt a new generation after its read permission was revoked", async () => {
	const response = deferred<void>();
	const runtime = createRuntime(
		options(
			resource({
				edits: {
					edit: {
						prepare: async (descriptor) => {
							await response.promise;
							return {
								descriptor,
								values: { name: "Old" },
								etag: "old",
								baseline: {},
								disclosure: "public",
								fieldDisclosure: { name: "read" },
								writeAccess: "write",
							};
						},
						command: () =>
							command({ resource: "things", name: "save", input: {} }),
					},
				},
			}),
		),
	);
	const prepared = runtime.prepareEdit({
		kind: "edit",
		resource: "things",
		name: "edit",
		target: "a",
	});
	await tick();
	runtime.revoke("read");
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	response.resolve();
	await assert.rejects(prepared, /Read access changed/);
	runtime.close();
});
