// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { edit, query } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { deferred } from "@hyecompany/vem-data/testing";

test("edit prerequisite failures cannot disclose retired authority details", {
	timeout: 5000,
}, async (t) => {
	const started = deferred<void>();
	const response = deferred<never>();
	let preparations = 0;
	const runtime = createRuntime({
		access: [{ scope: "notes:read", state: "allowed" }],
		resources: [
			{
				name: "tasks",
				fieldAccess: { $writable: "notes:read" },
				sources: [
					{
						key: "writable",
						mode: "one",
						fields: ["$writable"],
						access: "notes:read",
						async run() {
							started.resolve();
							return response.promise;
						},
					},
				],
				edits: {
					notes: {
						readPrerequisites: (descriptor) => [
							query({
								resource: "tasks",
								mode: "one",
								identity: descriptor.target,
								select: ["$writable"],
							}),
						],
						async prepare(descriptor) {
							preparations++;
							return {
								descriptor,
								values: { notes: "Private" },
								baseline: "Private",
								etag: "one",
								disclosure: "public",
								fieldDisclosure: { notes: "notes:read" },
								writeAccess: "public",
							};
						},
						command: () => ({
							kind: "command",
							resource: "tasks",
							name: "save",
							input: {},
						}),
					},
				},
			},
		],
	});
	t.after(() => runtime.close());
	let failure: unknown;
	const preparation = runtime
		.prepareEdit(edit({ resource: "tasks", name: "notes", target: "walk" }))
		.catch((error) => {
			failure = error;
		});
	await started.promise;
	runtime.revoke("notes:read");
	response.reject(new Error("Protected backend details for secret-owner"));
	await preparation;
	assert.ok(failure instanceof Error);
	assert.match(failure.message, /access|permission/i);
	assert.doesNotMatch(failure.message, /Protected backend|secret-owner/);
	assert.equal(preparations, 0);
});
