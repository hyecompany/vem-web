// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/index.js";
import { createRuntime } from "../../src/runtime.js";
import type { ResourceContext } from "../../src/types.js";

test("membership withdrawal retains permitted rows and reacquires only affected demand", async () => {
	const reads: unknown[] = [];
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const runtime = createRuntime({
		resources: [
			{
				name: "things",
				inScope: (identity, scope) =>
					(identity as { project: string }).project === scope,
				sources: [
					{
						key: "collection",
						mode: "list",
						fields: ["name"],
						membership: true,
						run: async (descriptor) => {
							reads.push(descriptor.scope);
							await pending;
							return {
								memberships: [
									{
										resource: "things",
										scope: descriptor.scope,
										identities: [{ project: "tenant", name: "a" }],
										complete: false,
										basis: ["public"],
									},
								],
							};
						},
					},
				],
				event: (_event, context) => ({
					invalidateMemberships: context
						.memberships("things")
						.filter((member) => member.scope === "tenant"),
				}),
			},
		],
	});
	const identity = { project: "tenant", name: "a" };
	try {
		runtime.observe({
			facts: [
				{
					resource: "things",
					identity,
					values: { name: "A" },
					basis: ["public"],
				},
			],
			memberships: [
				{
					resource: "things",
					scope: "tenant",
					identities: [identity],
					complete: true,
					basis: ["public"],
				},
				{
					resource: "things",
					scope: "other",
					identities: [],
					complete: true,
					basis: ["public"],
				},
			],
		});
		const descriptor = query({
			resource: "things",
			mode: "list",
			scope: "tenant",
			select: ["name"],
		});
		const tenant = runtime.watch(descriptor);
		const other = runtime.watch(
			query({
				resource: "things",
				mode: "list",
				scope: "other",
				select: ["name"],
			}),
		);
		const stop = tenant.subscribe(() => {});
		const stopOther = other.subscribe(() => {});
		runtime.event("things", {});
		assert.equal(tenant.getSnapshot().confirmed.complete, false);
		assert.equal(tenant.getSnapshot().rows[0]?.data.name, "A");
		assert.equal(other.getSnapshot().empty, true);
		release();
		const result = await runtime.read(descriptor);
		assert.equal(result.settled, true);
		assert.equal(result.confirmed.complete, false);
		assert.deepEqual(reads, ["tenant"]);
		stop();
		stopOther();
		tenant.dispose();
		other.dispose();
	} finally {
		release();
		runtime.close();
	}
});

test("collection evidence is access checked and older observations cannot repair or withdraw newer membership", () => {
	let captured!: ResourceContext;
	const runtime = createRuntime({
		resources: [
			{
				name: "things",
				event: (_event, context) => {
					captured = context;
				},
			},
		],
		access: [{ scope: "private", state: "allowed" }],
	});
	const membership = {
		resource: "things",
		scope: "tenant",
		identities: [],
		complete: true,
		basis: ["private"],
	};
	try {
		runtime.observe({ memberships: [membership] });
		runtime.event("things", {});
		const old = captured;
		assert.equal(old.memberships("things").length, 1);
		runtime.observe({ invalidateMemberships: [membership] });
		old.observe({ memberships: [membership] });
		assert.equal(runtime.membership("things", "tenant")?.complete, false);
		runtime.event("things", {});
		const beforeRepair = captured;
		runtime.observe({ memberships: [membership] });
		beforeRepair.observe({ invalidateMemberships: [membership] });
		assert.equal(runtime.membership("things", "tenant")?.complete, true);
		runtime.revoke("private");
		assert.deepEqual(captured.memberships("things"), []);
		captured.observe({
			memberships: [membership],
			invalidateMemberships: [membership],
		});
		assert.equal(runtime.membership("things", "tenant"), undefined);
	} finally {
		runtime.close();
	}
});

test("withdrawing collection completeness cannot recertify an obsolete predicate match", () => {
	const runtime = createRuntime({ resources: [{ name: "things" }] });
	const membership = {
		resource: "things",
		scope: "tenant",
		where: { status: "Running" },
		identities: ["a"],
		complete: true,
		basis: ["public"],
	};
	try {
		runtime.observe({
			facts: [
				{
					resource: "things",
					identity: "a",
					presence: "present",
					values: { name: "A", status: "Running" },
					basis: ["public"],
				},
			],
			memberships: [membership],
		});
		const view = runtime.watch(
			query({
				resource: "things",
				mode: "list",
				scope: "tenant",
				where: membership.where,
				select: ["name"],
			}),
		);
		runtime.observe({
			invalidate: [{ resource: "things", identity: "a", field: "status" }],
		});
		assert.equal(view.getSnapshot().rows.length, 0);
		assert.equal(view.getSnapshot().unresolved.length, 1);
		runtime.observe({ invalidateMemberships: [membership] });
		assert.equal(view.getSnapshot().rows.length, 0);
		assert.equal(view.getSnapshot().unresolved.length, 1);
		assert.equal(view.getSnapshot().unresolved[0]?.data.name, "A");
		assert.equal(view.getSnapshot().confirmed.complete, false);
	} finally {
		runtime.close();
	}
});

test("membership withdrawal fences the first in-flight response before an entry exists", () => {
	let captured!: ResourceContext;
	const runtime = createRuntime({
		resources: [
			{
				name: "things",
				event: (_event, context) => {
					captured = context;
				},
			},
		],
	});
	const membership = {
		resource: "things",
		scope: "tenant",
		identities: [],
		complete: true,
		basis: ["public"],
	};
	try {
		runtime.event("things", {});
		const old = captured;
		runtime.event("things", {});
		const current = captured;
		current.observe({ invalidateMemberships: [membership] });
		old.observe({ memberships: [membership] });
		assert.equal(runtime.membership("things", "tenant"), undefined);
		assert.equal(
			runtime
				.watch(
					query({
						resource: "things",
						mode: "list",
						scope: "tenant",
						select: ["name"],
					}),
				)
				.getSnapshot().empty,
			false,
		);

		current.observe({ memberships: [membership] });
		assert.equal(runtime.membership("things", "tenant")?.complete, true);
		old.observe({ invalidateMemberships: [membership] });
		assert.equal(runtime.membership("things", "tenant")?.complete, true);
	} finally {
		runtime.close();
	}
});
