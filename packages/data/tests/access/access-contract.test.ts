// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>

// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { test } from "node:test";

import { command, edit, query } from "@hyecompany/vem-data";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import { AccessRegistry } from "../../src/access.js";
import { proofLeaves } from "../../src/access-proofs.js";
import { EditSession } from "../../src/edit.js";

async function until(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt++)
		await new Promise<void>((resolve) => setImmediate(resolve));

	assert.ok(predicate(), "Expected edit transition");
}

test("alternative global read permissions admit one source and deny only after every route is denied", async (t) => {
	let reads = 0;

	const runtime = createRuntime({
		access: [
			{ scope: "team", state: "denied" },
			{ scope: "owner", state: "allowed" },
		],

		resources: [
			{
				name: "tasks",

				access: { any: ["team", "owner"] },

				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["title"],
						run: async () => {
							reads++;

							return {
								facts: [
									{
										resource: "tasks",
										identity: "walk",
										presence: "present",
										values: { title: "Plan a walk" },
										basis: ["owner"],
									},
								],
							};
						},
					},
				],
			},
		],
	});

	t.after(() => runtime.close());

	const selected = query({
		resource: "tasks",
		mode: "one",
		identity: "walk",
		select: ["title"],
	});

	const result = await runtime.read(selected);

	assert.equal(reads, 1);

	assert.equal(result.rows[0]?.data.title, "Plan a walk");

	assert.deepEqual(result.issues, []);

	runtime.revoke("owner");

	const denied = await runtime.read(selected);

	assert.equal(reads, 1);

	assert.equal(denied.rows.length, 0);

	assert.ok(denied.issues.some((issue) => issue.kind === "access"));
});

test("commands keep admission alternatives separate from activity disclosure", async (t) => {
	const runtime = createRuntime({
		access: [
			{ scope: "write", state: "denied" },
			{ scope: "admin", state: "allowed" },
			{ scope: "read", state: "allowed" },
		],

		resources: [
			{
				name: "tasks",
				commands: {
					complete: {
						access: { any: ["write", "admin"] },
						disclosure: "read",

						run: async () => ({ kind: "succeeded", value: "Completed" }),
					},
				},
			},
		],
	});

	t.after(() => runtime.close());

	const selected = command({ resource: "tasks", name: "complete", input: {} });

	assert.equal(runtime.availability(selected).state, "available");

	assert.equal((await runtime.run(selected).result).kind, "succeeded");

	runtime.revoke("admin");

	assert.equal(runtime.availability(selected).state, "denied");

	assert.equal(runtime.listActivities()[0]?.outcome?.kind, "succeeded");

	runtime.revoke("read");

	assert.equal(runtime.listActivities().length, 0);
});

test("an editor inherits independent disclosure proofs and removes only values losing their last permission", async (t) => {
	const runtime = createRuntime({
		access: ["team", "owner", "write"].map((scope) => ({
			scope,
			state: "allowed",
		})),

		resources: [
			{
				name: "tasks",
				edits: {
					notes: {
						prepare: async (descriptor, context) => ({
							descriptor,
							values: { title: "Plan a walk", notes: "Private route" },

							baseline: { notes: "Private route" },
							etag: "one",

							disclosure: context.disclosure({
								resource: "tasks",
								identity: "walk",
								field: "$writable",
							}),

							fieldDisclosure: { title: "public" },
							writeAccess: "write",
						}),

						command: () =>
							command({ resource: "tasks", name: "save", input: {} }),
					},
				},
			},
		],
	});

	t.after(() => runtime.close());

	for (const basis of ["team", "owner"])
		runtime.observe({
			facts: [
				{
					resource: "tasks",
					identity: "walk",
					presence: "present",
					values: { $writable: { notes: "Private route", etag: "one" } },
					basis: [basis],
				},
			],
		});

	const session = new EditSession(
		runtime,
		edit<{ title: string; notes: string }>({
			resource: "tasks",
			name: "notes",
			target: "walk",
		}),
	);

	const stop = session.subscribe(() => undefined);

	t.after(() => {
		stop();
		session.dispose();
	});

	await until(() => session.getSnapshot().status === "ready");

	session.set("notes", "My unsaved route");

	runtime.revoke("write");

	assert.equal(session.getSnapshot().canSave, false);

	assert.equal(session.getSnapshot().values.notes, "My unsaved route");

	runtime.revoke("team");

	assert.equal(session.getSnapshot().values.notes, "My unsaved route");

	runtime.revoke("owner");

	assert.equal(session.getSnapshot().values.notes, undefined);

	assert.equal(session.getSnapshot().values.title, "Plan a walk");

	assert.deepEqual(session.getSnapshot().missing, ["notes"]);

	runtime.setAccess({ decisions: [{ scope: "owner", state: "allowed" }] });

	assert.equal(session.getSnapshot().values.notes, undefined);
});

test("retiring one alternative prunes its proof without losing surviving or unknown authority", () => {
	const access = new AccessRegistry("alice", [
		{ scope: "team", state: "allowed" },
		{ scope: "owner", state: "allowed" },
	]);
	const team = access.ref("team");
	const owner = access.ref("owner");
	const pending = access.ref("unestablished");
	const publicProof = access.ref("public");
	const proof = { all: [publicProof, { any: [team, owner] }] };
	access.apply({ decisions: [{ scope: "team", state: "denied" }] });
	assert.deepEqual(access.surviving([proof]).flatMap(proofLeaves), [
		publicProof,
		owner,
	]);
	assert.deepEqual(
		access
			.surviving([{ any: [{ all: [team, pending] }, publicProof] }])
			.flatMap(proofLeaves),
		[publicProof],
	);
	assert.deepEqual(access.surviving([pending]), [pending]);
	assert.deepEqual(access.surviving([{ all: [] }, { any: [] }]), [{ all: [] }]);
	access.apply({ decisions: [{ scope: "owner", state: "denied" }] });
	assert.deepEqual(access.surviving([proof]), []);
});
