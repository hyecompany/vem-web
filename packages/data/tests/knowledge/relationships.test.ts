// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { query } from "../../src/index.js";
import { createRuntime, DexiePersistence } from "../../src/runtime.js";
import { MemoryPersistence } from "../../src/testing.js";
import type {
	RelationshipObservation,
	ResourceContext,
	ResourceDefinition,
} from "../../src/types.js";

const continuity = { channel: "test-events" };

const a = { resource: "instances", identity: "a" };
const b = { resource: "instances", identity: "b" };
const relation = (
	targets: RelationshipObservation["targets"] = [a],
	options: Partial<RelationshipObservation> = {},
): RelationshipObservation => ({
	liveness: continuity,
	resource: "profiles",
	identity: "p",
	relationship: "used_by",
	targets,
	complete: true,
	basis: ["profile"],
	...options,
});
const definitions = (
	profile: Partial<ResourceDefinition> = {},
): ResourceDefinition[] => [
	{
		name: "profiles",
		persistRelationship: () => true,
		persist: () => true,
		...profile,
	},
	{ name: "instances", persist: () => true },
];
const access = [
	{ scope: "profile", state: "allowed" as const },
	{ scope: "independent", state: "allowed" as const },
];

test("relationships are independent evidence without endpoint fields or implied target existence", () => {
	const runtime = createRuntime({ resources: definitions(), access });
	try {
		runtime.observe({ relationships: [relation([a, b], { complete: false })] });
		assert.deepEqual(runtime.relationship("profiles", "p", "used_by"), {
			targets: [a, b],
			complete: false,
			liveness: "snapshot",
			stale: false,
		});
		assert.equal(
			runtime
				.watch(
					query({
						resource: "instances",
						mode: "one",
						identity: "a",
						select: ["name"],
					}),
				)
				.getSnapshot().exists,
			undefined,
		);
		assert.equal(
			runtime
				.watch(
					query({
						resource: "profiles",
						mode: "one",
						identity: "p",
						select: ["used_by"],
					}),
				)
				.getSnapshot().rows.length,
			0,
		);
		runtime.observe({
			facts: [
				{
					liveness: continuity,
					resource: "instances",
					identity: "a",
					presence: "present",
					values: { name: "A" },
					basis: ["independent"],
				},
			],
		});
		runtime.observe({ relationships: [relation([a])] });
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[a],
		);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			true,
		);
		runtime.observe({ relationships: [relation([])] });
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			true,
		);
		assert.equal(
			runtime
				.watch(
					query({
						resource: "instances",
						mode: "one",
						identity: "a",
						select: ["name"],
					}),
				)
				.getSnapshot().rows[0]?.data.name,
			"A",
		);
	} finally {
		runtime.close();
	}
});

test("replacement and revocation preserve only independently supported relationship targets", () => {
	const runtime = createRuntime({ resources: definitions(), access });
	try {
		runtime.observe({
			relationships: [
				relation([a, b]),
				relation([b], { basis: ["independent"], complete: false }),
			],
		});
		runtime.observe({ relationships: [relation([a])] });
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[a, b],
		);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			false,
		);
		runtime.revoke("profile");
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
		runtime.setAccess({ decisions: [{ scope: "profile", state: "allowed" }] });
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
		runtime.revoke("independent");
		assert.equal(runtime.relationship("profiles", "p", "used_by"), undefined);
	} finally {
		runtime.close();
	}
});

test("relationship dependencies forget derived disclosures and mark changed inputs uncertain", () => {
	const runtime = createRuntime({ resources: definitions(), access });
	const descriptor = query({
		resource: "profiles",
		mode: "one",
		identity: "p",
		select: ["summary"],
	});
	try {
		runtime.observe({
			relationships: [
				relation([a]),
				relation([b], { basis: ["independent"], complete: false }),
			],
			facts: [
				{
					liveness: continuity,
					resource: "profiles",
					identity: "p",
					presence: "present",
					basis: ["independent"],
				},
			],
		});
		runtime.observe({
			facts: [
				{
					liveness: continuity,
					resource: "profiles",
					identity: "p",
					values: { summary: "a and b" },
					basis: ["independent"],
					dependsOn: [
						{ resource: "profiles", identity: "p", relationship: "used_by" },
					],
				},
			],
		});
		assert.equal(
			runtime.watch(descriptor).getSnapshot().rows[0]?.data.summary,
			"a and b",
		);
		runtime.observe({ relationships: [relation([])] });
		assert.equal(
			runtime.watch(descriptor).getSnapshot().rows[0]?.fields.summary?.stale,
			true,
		);
		runtime.revoke("profile");
		assert.equal(
			runtime.watch(descriptor).getSnapshot().rows[0]?.data.summary,
			undefined,
		);
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
	} finally {
		runtime.close();
	}
});

test("late relationship responses obey newer observations, coverage gaps, and access generations", () => {
	let context: ResourceContext | undefined;
	const runtime = createRuntime({
		resources: definitions({
			event: (_event, value) => {
				context = value;
			},
		}),
		access,
	});
	try {
		runtime.event("profiles", {});
		const old = context;
		runtime.observe({ relationships: [relation([b])] });
		old?.observe({ relationships: [relation([a])] });
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
		runtime.event("profiles", {});
		const gap = context;
		runtime.setContinuity(continuity, "interrupted");
		gap?.observe({ relationships: [relation([a])] });
		assert.equal(runtime.relationship("profiles", "p", "used_by")?.stale, true);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			false,
		);
		runtime.event("profiles", {});
		const revoked = context;
		runtime.revoke("profile");
		runtime.setAccess({ decisions: [{ scope: "profile", state: "allowed" }] });
		revoked?.observe({ relationships: [relation([a])] });
		assert.equal(runtime.relationship("profiles", "p", "used_by"), undefined);
	} finally {
		runtime.close();
	}
});

test("relationship persistence restores uncertain evidence, honors revocation, and reports erasure failure", async () => {
	const persistence = new MemoryPersistence();
	const options = {
		resources: definitions(),
		access,
		contextId: "member",
		persistence,
	};
	const first = createRuntime(options);
	await first.ready;
	first.observe({ relationships: [relation([a])] });
	await first.flush();
	first.close();
	const restored = createRuntime(options);
	await restored.ready;
	assert.deepEqual(restored.relationship("profiles", "p", "used_by")?.targets, [
		a,
	]);
	assert.equal(restored.relationship("profiles", "p", "used_by")?.stale, true);
	assert.equal(
		restored.relationship("profiles", "p", "used_by")?.complete,
		false,
	);
	persistence.failure = new Error("storage unavailable");
	restored.revoke("profile");
	assert.equal(restored.relationship("profiles", "p", "used_by"), undefined);
	await assert.rejects(restored.flush(), /storage unavailable/);
	persistence.failure = undefined;
	restored.close();
	const revoked = createRuntime({
		...options,
		access: [{ scope: "profile", state: "denied" }],
	});
	await revoked.ready;
	assert.equal(revoked.relationship("profiles", "p", "used_by"), undefined);
	await revoked.flush();
	revoked.close();
});

test("adapters can reuse permitted membership evidence and lose completeness at a coverage gap", () => {
	let context: ResourceContext | undefined;
	const runtime = createRuntime({
		resources: definitions({
			event: (_event, value) => {
				context = value;
			},
		}),
		access,
	});
	try {
		runtime.observe({
			memberships: [
				{
					liveness: continuity,
					resource: "profiles",
					scope: { project: "default" },
					identities: ["p"],
					complete: true,
					basis: ["profile"],
				},
			],
		});
		runtime.event("profiles", {});
		assert.deepEqual(context?.membership("profiles", { project: "default" }), {
			identities: ["p"],
			complete: true,
		});
		runtime.setContinuity(continuity, "interrupted");
		assert.equal(
			context?.membership("profiles", { project: "default" })?.complete,
			false,
		);
		runtime.revoke("profile");
		assert.equal(
			context?.membership("profiles", { project: "default" }),
			undefined,
		);
	} finally {
		runtime.close();
	}
});

test("relationship references are captured and durable revocation fences queued writes", async () => {
	const persistence = new DexiePersistence(
		`relationships-${crypto.randomUUID()}`,
		{ indexedDB, IDBKeyRange },
	);
	const runtime = createRuntime({
		resources: definitions(),
		access,
		contextId: "member",
		persistence,
	});
	try {
		await runtime.ready;
		const target = { resource: "instances", identity: { name: "original" } };
		runtime.observe({ relationships: [relation([target])] });
		target.identity.name = "changed";
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[{ resource: "instances", identity: { name: "original" } }],
		);
		await runtime.flush();
		const saved = await persistence.load();
		assert.equal(saved.facts.length, 2);
		assert(saved.facts.every((fact) => fact.kind === "relationship"));
		runtime.revoke("profile");
		await runtime.flush();
		await persistence.writeFacts(
			saved.facts.map((fact) => ({ ...fact, revision: fact.revision + 100 })),
			[],
		);
		assert.equal((await persistence.load()).facts.length, 0);
	} finally {
		runtime.close();
	}
});

test("an explicit reference removal retires only that target from a partial set", () => {
	const runtime = createRuntime({ resources: definitions(), access });
	try {
		runtime.observe({
			relationships: [
				relation([a, b]),
				relation([a], { complete: false, basis: ["independent"] }),
			],
		});
		runtime.observe({
			relationships: [
				relation([], {
					complete: false,
					removed: [b],
					dependsOn: [
						{ resource: "profiles", identity: "p", field: "missing" },
					],
				}),
			],
		});
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[a, b],
		);
		runtime.observe({
			relationships: [relation([], { complete: false, removed: [a] })],
		});
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			false,
		);
	} finally {
		runtime.close();
	}
});

test("repeated incomplete relationships settle a read without retrying unavailable fields", async () => {
	let reads = 0;
	const incomplete = relation([], { complete: false });
	const runtime = createRuntime({
		resources: definitions({
			sources: [
				{
					key: "detail",
					mode: "one",
					fields: ["name", "unavailable"],
					run: async () => {
						if (++reads > 2) throw new Error("Unexpected repeated acquisition");
						return {
							facts: [
								{
									liveness: continuity,
									resource: "profiles",
									identity: "p",
									presence: "present",
									values: { name: "P" },
									basis: ["profile"],
								},
							],
							relationships: [incomplete],
						};
					},
				},
			],
		}),
		access,
	});
	try {
		runtime.observe({ relationships: [incomplete] });
		const result = await runtime.read(
			query({
				resource: "profiles",
				mode: "one",
				identity: "p",
				select: ["name", "unavailable"],
			}),
		);
		assert.equal(reads, 1);
		assert.equal(result.settled, true);
		assert.equal(result.issues[0]?.kind, "incomplete");
		assert.deepEqual(result.rows[0]?.missing, ["unavailable"]);
	} finally {
		runtime.close();
	}
});

test("identical relationship truth preserves derived values while changed edges mark them uncertain", () => {
	const runtime = createRuntime({ resources: definitions(), access });
	const descriptor = query({
		resource: "profiles",
		mode: "one",
		identity: "p",
		select: ["summary"],
	});
	try {
		runtime.observe({ relationships: [relation([a, b])] });
		runtime.observe({
			facts: [
				{
					liveness: continuity,
					resource: "profiles",
					identity: "p",
					presence: "present",
					values: { summary: "a and b" },
					basis: ["profile"],
					dependsOn: [
						{ resource: "profiles", identity: "p", relationship: "used_by" },
					],
				},
			],
		});
		runtime.observe({ relationships: [relation([b, a])] });
		assert.equal(
			runtime.watch(descriptor).getSnapshot().rows[0]?.fields.summary?.stale,
			undefined,
		);
		runtime.observe({ relationships: [relation([a])] });
		assert.equal(
			runtime.watch(descriptor).getSnapshot().rows[0]?.fields.summary?.stale,
			true,
		);
	} finally {
		runtime.close();
	}
});

test("target-specific disclosure withdraws one edge and its protected completeness marker", async () => {
	const persistence = new MemoryPersistence();
	const runtime = createRuntime({
		resources: definitions(),
		access: [
			...access,
			{ scope: "instance:a", state: "allowed" },
			{ scope: "instance:b", state: "allowed" },
		],
		persistence,
	});
	try {
		await runtime.ready;
		runtime.observe({
			relationships: [
				relation([a, b], {
					targetBasis: [
						{ target: a, basis: [{ all: ["profile", "instance:a"] }] },
						{ target: b, basis: [{ all: ["profile", "instance:b"] }] },
					],
				}),
			],
		});
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			true,
		);
		await runtime.flush();
		runtime.revoke("instance:a");
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			false,
		);
		await runtime.flush();
		assert.equal(
			[...persistence.facts.values()].some((value) =>
				JSON.stringify(value).includes('"identity":"a"'),
			),
			false,
		);
	} finally {
		runtime.close();
	}
});

test("target proofs resolve same-batch grants and cannot capture a later regrant", () => {
	let context: ResourceContext | undefined;
	const runtime = createRuntime({
		resources: definitions({
			event: (_event, current) => {
				context = current;
			},
		}),
		access,
	});
	try {
		runtime.event("profiles", {});
		const observation = relation([a, b], {
			targetBasis: [
				{ target: a, basis: [{ all: ["profile", "instance:a"] }] },
				{ target: b, basis: [{ all: ["profile", "instance:b"] }] },
			],
		});
		context?.observe({
			grants: [
				{ scope: "instance:a", state: "allowed" },
				{ scope: "instance:b", state: "allowed" },
			],
			relationships: [observation],
		});
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[a, b],
		);
		runtime.revoke("instance:a");
		runtime.setAccess({
			decisions: [{ scope: "instance:a", state: "allowed" }],
		});
		context?.observe({ relationships: [observation] });
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
	} finally {
		runtime.close();
	}
});

test("complete replacement preserves independent target bases while explicit removal retires the edge", () => {
	const runtime = createRuntime({ resources: definitions(), access });
	try {
		runtime.observe({
			relationships: [
				relation([a, b], {
					targetBasis: [
						{ target: a, basis: ["independent"] },
						{ target: b, basis: ["profile"] },
					],
				}),
			],
		});
		runtime.observe({
			relationships: [
				relation([b], { targetBasis: [{ target: b, basis: ["profile"] }] }),
			],
		});
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[a, b],
		);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			false,
		);
		runtime.observe({
			relationships: [
				relation([b], {
					removed: [a],
					targetBasis: [{ target: b, basis: ["profile"] }],
				}),
			],
		});
		assert.deepEqual(
			runtime.relationship("profiles", "p", "used_by")?.targets,
			[b],
		);
		assert.equal(
			runtime.relationship("profiles", "p", "used_by")?.complete,
			true,
		);
	} finally {
		runtime.close();
	}
});
