// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, query } from "../../src/descriptors.js";
import { ReadModelProjection } from "../../src/read-model/projection.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";
import { deferred } from "../../src/testing.js";
import type {
	ActionOutcome,
	QueryDescriptor,
	ResourceDefinition,
} from "../../src/types.js";
import {
	options,
	resource,
	fact as scenarioFact,
	tick,
} from "../support/scenario.js";

function mirror(runtime: Runtime, definitions: readonly ResourceDefinition[]) {
	const projection = new ReadModelProjection(definitions);
	const sync = () =>
		projection.setSnapshot(
			runtime.readModelSnapshot(),
			runtime.accessSnapshot(),
			runtime.listActivities(),
		);
	sync();
	return { projection, sync };
}
function parity(
	runtime: Runtime,
	projection: ReadModelProjection,
	descriptor: QueryDescriptor,
) {
	const watch = runtime.watch(descriptor);
	assert.deepEqual(
		{ ...projection.project(descriptor), revision: 0 },
		{ ...watch.getSnapshot(), revision: 0 },
	);
	watch.dispose();
}

test("unseen filters, selections, details and extracted resources project synchronously from one disclosed model", () => {
	let reads = 0;
	const definition = resource({
		sources: [
			{
				key: "collection",
				mode: "list",
				fields: ["name", "status", "description"],
				membership: true,
				run: async () => {
					reads++;
				},
			},
		],
	});
	const other: ResourceDefinition = { ...definition, name: "related" };
	const runtime = createRuntime({
		...options(),
		resources: [definition, other],
	});
	runtime.observe({
		facts: [
			fact("a", { name: "A", status: "running", description: "Known" }),
			fact("b", { name: "B", status: "stopped" }),
			{ ...fact("extracted", { name: "Related" }), resource: "related" },
		],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: ["a", "b"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const { projection, sync } = mirror(runtime, [definition, other]);
	const running = query({
		resource: "things",
		mode: "list",
		select: ["name", "status"],
		where: { status: "running" },
	});
	const empty = { ...running, where: { status: "missing" } };
	const detail = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["description"],
	});
	const extracted = query({
		resource: "related",
		mode: "one",
		identity: "extracted",
		select: ["name"],
	});
	for (const descriptor of [running, empty, detail, extracted])
		parity(runtime, projection, descriptor);
	assert.equal(projection.project(running).rows[0]?.data.name, "A");
	assert.equal(projection.project(running).settled, true);
	assert.equal(projection.project(empty).empty, true);
	assert.equal(projection.project(detail).rows[0]?.data.description, "Known");
	const before = runtime.readModelSnapshot();
	assert.equal(runtime.readModelSnapshot(), before);
	runtime.observe({ facts: [fact("b", { name: "Changed" })] });
	const after = runtime.readModelSnapshot();
	assert.equal(
		before.records.find((record) => record.confirmed?.identity === "a"),
		after.records.find((record) => record.confirmed?.identity === "a"),
	);
	sync();
	parity(runtime, projection, running);
	runtime.observe({ facts: [fact("a", { description: "Updated" })] });
	sync();
	const all = query({ resource: "things", mode: "list", select: ["name"] });
	parity(runtime, projection, all);
	assert.deepEqual(
		projection
			.project(all)
			.rows.map((row) =>
				row.identity.kind === "resource"
					? { kind: row.identity.kind, resource: row.identity.resource }
					: row.identity,
			),
		[
			{ kind: "resource", resource: "a" },
			{ kind: "resource", resource: "b" },
		],
	);
	assert.equal(reads, 0);
	runtime.close();
});

test("missing and stale predicate fields stay unresolved while missing display fields retain rows", () => {
	const definition = resource();
	const runtime = createRuntime(options(definition));
	runtime.observe({
		facts: [fact("a", { name: "A" })],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const { projection, sync } = mirror(runtime, [definition]);
	const all = query({
		resource: "things",
		mode: "list",
		select: ["name", "description"],
	});
	const running = { ...all, where: { status: "running" } };
	parity(runtime, projection, all);
	parity(runtime, projection, running);
	assert.equal(projection.project(all).rows[0]?.complete, false);
	assert.equal(projection.project(running).unresolved.length, 1);
	assert.equal(projection.project(running).empty, false);
	runtime.observe({
		facts: [fact("a", { status: "running" })],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				where: { status: "running" },
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	runtime.observe({ facts: [{ ...fact("a", {}), replace: ["status"] }] });
	sync();
	parity(runtime, projection, running);
	assert.equal(projection.project(running).unresolved.length, 1);
	runtime.observe({ facts: [fact("a", { status: "running" })] });
	runtime.setContinuity(continuity, "interrupted");
	sync();
	parity(runtime, projection, running);
	assert.equal(projection.project(running).confirmed.complete, false);
	assert.equal(projection.project(running).unresolved.length, 1);
	runtime.close();
});

test("replica facts preserve independent disclosure and never contain concealed identities or proof storage", () => {
	const definition = resource();
	const runtime = createRuntime(options(definition));
	runtime.observe({
		facts: [
			fact("a", { secret: "protected" }),
			fact("concealed", { name: "hidden" }),
			{
				liveness: continuity,
				resource: "things",
				identity: "a",
				values: { label: "public" },
				presence: "present",
				basis: ["public"],
			},
		],
	});
	const { projection, sync } = mirror(runtime, [definition]);
	const detail = query({
		resource: "things",
		mode: "one",
		identity: "a",
		select: ["secret", "label"],
	});
	runtime.setAccess({ decisions: [{ scope: "read", state: "unknown" }] });
	sync();
	parity(runtime, projection, detail);
	assert.equal(projection.project(detail).rows[0]?.data.label, "public");
	const text = JSON.stringify(runtime.readModelSnapshot());
	for (const hidden of [
		"protected",
		"concealed",
		"hidden",
		"bases",
		"dependencies",
		"etag",
	])
		assert.equal(text.includes(hidden), false);
	runtime.revoke("read");
	runtime.setAccess({ decisions: [{ scope: "read", state: "allowed" }] });
	sync();
	assert.equal(projection.project(detail).rows[0]?.data.secret, undefined);
	assert.equal(projection.project(detail).rows[0]?.data.label, "public");
	runtime.close();
});

test("confirmed counts remain separate from proposed matching values and rollback reveals latest facts", async () => {
	const outcome = deferred<ActionOutcome>();
	const definition = resource({
		commands: {
			start: {
				access: () => "read",
				disclosure: () => "read",
				project: (descriptor) => [
					{
						resource: "things",
						identity: descriptor.target,
						kind: "update",
						values: { status: "running" },
						basis: ["read"],
					},
				],
				run: () => outcome.promise,
			},
		},
	});
	const runtime = createRuntime(options(definition));
	runtime.observe({
		facts: [fact("a", { name: "Before", status: "stopped" })],
		memberships: [
			{
				liveness: continuity,
				resource: "things",
				identities: ["a"],
				complete: true,
				basis: ["read"],
			},
		],
	});
	const { projection, sync } = mirror(runtime, [definition]);
	const filtered = query({
		resource: "things",
		mode: "list",
		select: ["name", "status"],
		where: { status: "running" },
	});
	const action = runtime.run(
		command({ resource: "things", name: "start", target: "a", input: {} }),
	);
	await tick();
	sync();
	parity(runtime, projection, filtered);
	assert.equal(projection.project(filtered).rows.length, 1);
	assert.equal(projection.project(filtered).confirmed.knownCount, 0);
	runtime.observe({ facts: [fact("a", { name: "Newer", status: "running" })] });
	outcome.resolve({ kind: "failed", error: { message: "Rejected" } });
	await action.result;
	sync();
	parity(runtime, projection, filtered);
	assert.equal(projection.project(filtered).rows[0]?.data.name, "Newer");
	assert.equal(
		projection.project(filtered).rows[0]?.fields.status?.source,
		"observed",
	);
	assert.equal(projection.project(filtered).confirmed.knownCount, 1);
	runtime.close();
});

test("scoped coverage fences survive without redisclosing a revoked project identifier", () => {
	const definition = resource({
		key: (identity) => String(identity),
		inScope: (identity, scope) =>
			String(identity).startsWith(`${String(scope)}:`),
		access: (descriptor) => String(descriptor.scope),
	});
	const runtime = createRuntime({
		...options(definition),
		access: [
			{ scope: "secret-project", state: "allowed" },
			{ scope: "other", state: "allowed" },
		],
	});
	for (const scope of ["secret-project", "other"])
		runtime.observe({
			facts: [
				{
					liveness: { ...continuity, scope },
					resource: "things",
					identity: `${scope}:a`,
					presence: "present",
					values: { name: scope },
					basis: [scope],
				},
			],
			memberships: [
				{
					liveness: { ...continuity, scope },
					resource: "things",
					scope,
					identities: [`${scope}:a`],
					complete: true,
					basis: [scope],
				},
			],
		});
	runtime.setContinuity(
		{ ...continuity, scope: "secret-project" },
		"interrupted",
	);
	runtime.revoke("secret-project");
	const { projection } = mirror(runtime, [definition]);
	const descriptor = query({
		resource: "things",
		mode: "list",
		scope: "other",
		select: ["name"],
	});
	parity(runtime, projection, descriptor);
	assert.equal(projection.project(descriptor).confirmed.complete, true);
	assert.equal(
		JSON.stringify(runtime.readModelSnapshot()).includes("secret-project"),
		false,
	);
	runtime.close();
	assert.equal(runtime.readModelSnapshot().records.length, 0);
});

test("membership retention protects used scope proofs while bounding unrelated filtered boundaries", () => {
	for (const mode of ["list", "one"] as const) {
		const definition = resource({
			inScope: (_identity, _scope, values) =>
				values.location === undefined
					? "unknown"
					: values.location === "member",
		});
		const runtime = createRuntime({
			...options(definition),
			maxInactiveQueries: 1,
		});
		const descriptor = query({
			resource: "things",
			mode,
			identity: mode === "one" ? "a" : undefined,
			scope: "member",
			select: ["name"],
		});
		const view = runtime.watch(descriptor);
		const stop = view.subscribe(() => undefined);
		runtime.observe({
			facts: [fact("a", { name: "A" })],
			memberships: [
				{
					liveness: continuity,
					resource: "things",
					scope: "member",
					where: { status: "running" },
					identities: ["a"],
					complete: false,
					basis: ["read"],
				},
				...Array.from({ length: 12 }, (_, index) => ({
					liveness: continuity,
					resource: "things",
					scope: "member",
					where: { status: String(index) },
					identities: [],
					complete: true,
					basis: ["read"],
				})),
			],
		});
		const model = runtime.readModelSnapshot();
		assert.equal(model.memberships.length, 2);
		assert.ok(
			model.memberships.some(
				(membership) => membership.where?.status === "running",
			),
		);
		assert.equal(view.getSnapshot().rows[0]?.data.name, "A");
		const { projection } = mirror(runtime, [definition]);
		parity(runtime, projection, descriptor);
		stop();
		assert.equal(runtime.readModelSnapshot().memberships.length, 1);
		view.dispose();
		runtime.close();
	}
});
const continuity = { channel: "test-events" };
const fact = (...args: Parameters<typeof scenarioFact>) => ({
	...scenarioFact(...args),
	liveness: continuity,
});
