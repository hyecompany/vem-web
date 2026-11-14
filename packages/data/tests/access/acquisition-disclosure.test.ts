// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, edit, query } from "../../src/descriptors.js";
import { AcquisitionError, createRuntime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type { ObservationBatch } from "../../src/types.js";
import { fact, list, options, resource, tick } from "../support/scenario.js";

test("late acquisition errors cannot cross caller retirement or selective revocation and regrant", async () => {
	for (const transition of ["context", "revoke", "regrant"] as const) {
		const response = deferred<ObservationBatch>();
		let calls = 0;
		const runtime = createRuntime(
			options(
				resource({
					sources: [
						{
							key: "collection",
							mode: "list",
							fields: ["name", "status"],
							membership: true,
							run: async () => {
								if (++calls === 1) return response.promise;
								throw new Error("Current request failed");
							},
						},
					],
				}),
			),
		);
		const handle = runtime.watch(list);
		const seen: string[] = [];
		const stop = handle.subscribe(() =>
			seen.push(...handle.getSnapshot().issues.map((issue) => issue.message)),
		);
		try {
			await tick();
			assert.equal(calls, 1);
			if (transition === "context")
				runtime.setAccess({
					contextId: "bob",
					decisions: [{ scope: "read", state: "allowed" }],
				});
			else {
				runtime.revoke("read");
				if (transition === "regrant")
					runtime.setAccess({
						decisions: [{ scope: "read", state: "allowed" }],
					});
			}
			response.reject(
				new AcquisitionError({
					kind: "access",
					message: "Previous caller's protected detail",
				}),
			);
			await tick();
			await tick();
			assert.equal(
				seen.includes("Previous caller's protected detail"),
				false,
				transition,
			);
			assert.equal(handle.getSnapshot().settled, true);
			if (transition !== "revoke") {
				assert.equal(calls, 2);
				assert.ok(seen.includes("Current request failed"));
				runtime.revoke("read");
				assert.equal(
					handle.getSnapshot().issues.some((issue) => issue.kind === "read"),
					false,
				);
			} else assert.equal(calls, 1);
		} finally {
			stop();
			handle.dispose();
			runtime.close();
		}
	}
});

test("current errors survive ordinary observations, unrelated revocation and unknown authorization becoming allowed", async () => {
	for (const initial of ["allowed", "unknown"] as const) {
		const response = deferred<ObservationBatch>();
		const runtime = createRuntime({
			...options(
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
			access: [{ scope: "read", state: initial }],
		});
		try {
			const pending = runtime.read(list);
			await tick();
			runtime.observe({
				facts: [fact("unrelated", { description: "new observation" })],
			});
			runtime.revoke("unrelated");
			runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
			response.reject(new Error("Current read failed"));
			assert.ok(
				(await pending).issues.some(
					(issue) => issue.message === "Current read failed",
				),
			);
		} finally {
			runtime.close();
		}
	}
});

test("shared-source failures require every participating query's disclosure permission", async () => {
	const response = deferred<ObservationBatch>();
	let calls = 0;
	const definition = resource({
		access: (descriptor) => String(descriptor.identity),
		sources: [
			{
				key: "collection",
				mode: "list",
				fields: ["name"],
				membership: true,
				run: async () => {
					calls++;
					if (calls === 1) return response.promise;
					throw new Error("Current public source failure");
				},
			},
		],
	});
	const runtime = createRuntime({
		...options(definition),
		access: [{ scope: "private", state: "allowed" }],
	});
	try {
		const descriptors = ["private", "public"].map((identity) =>
			query({ resource: "things", mode: "one", identity, select: ["name"] }),
		);
		const pending = descriptors.map((descriptor) => runtime.read(descriptor));
		await tick();
		assert.equal(calls, 1);
		runtime.revoke("private");
		response.reject(new Error("Failure containing private resource detail"));
		for (const result of await Promise.all(pending)) {
			assert.equal(result.settled, true);
			assert.equal(
				result.issues.some((issue) =>
					issue.message.includes("private resource detail"),
				),
				false,
			);
		}
	} finally {
		runtime.close();
	}
});

test("edit preparation failures settle without obsolete details but preserve current errors", async () => {
	for (const transition of [
		"context",
		"regrant",
		"close",
		"observation",
		"grant",
	] as const) {
		const response = deferred<never>();
		const runtime = createRuntime(
			options(
				resource({
					edits: {
						settings: {
							prepare: () => response.promise,
							command: () =>
								command({ resource: "things", name: "save", input: {} }),
						},
					},
				}),
			),
		);
		try {
			const pending = runtime
				.prepareEdit(
					edit({ resource: "things", name: "settings", target: "a" }),
				)
				.then(
					() => undefined,
					(error) => error,
				);
			await tick();
			if (transition === "context")
				runtime.setAccess({ contextId: "bob", decisions: [] });
			else if (transition === "regrant") {
				runtime.revoke("read");
				runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
			} else if (transition === "close") runtime.close();
			else if (transition === "observation")
				runtime.observe({ facts: [fact("a", { name: "New" })] });
			else
				runtime.setAccess({
					decisions: [{ scope: "additional", state: "allowed" }],
				});
			response.reject(new Error("Protected preparation detail"));
			const error = await pending;
			assert.ok(error instanceof Error);
			assert.equal(
				error.message === "Protected preparation detail",
				transition === "observation" || transition === "grant",
				transition,
			);
			await tick();
		} finally {
			runtime.close();
		}
	}
});

test("classified acquisition denial is retryable and does not revoke independently readable data", async () => {
	let denied = true;
	const runtime = createRuntime(
		options(
			resource({
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name", "status"],
						membership: true,
						run: async () => {
							if (denied)
								throw new AcquisitionError({
									kind: "access",
									message: "Listing is denied",
									scope: "list",
								});
							return {
								memberships: [
									{
										resource: "things",
										identities: [],
										complete: true,
										basis: ["read"],
									},
								],
							};
						},
					},
				],
			}),
		),
	);
	const handle = runtime.watch(list);
	try {
		runtime.observe({ facts: [fact("a", { name: "A", status: "ready" })] });
		const result = await handle.retry();
		assert.deepEqual(result.issues, [
			{ kind: "access", message: "Listing is denied", scope: "list" },
		]);
		assert.equal(runtime.accessSnapshot().scopes.read?.state, "allowed");
		assert.equal(result.rows.length, 1);
		denied = false;
		assert.deepEqual((await handle.retry()).issues, []);
	} finally {
		handle.dispose();
		runtime.close();
	}
});
