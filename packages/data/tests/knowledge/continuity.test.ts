// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/descriptors.js";
import { createRuntime } from "../../src/runtime.js";
import { deferred, MemoryPersistence } from "../../src/testing.js";
import type {
	FactObservation,
	ObservationBatch,
	ResourceDefinition,
} from "../../src/types.js";

const alpha = { channel: "changes", scope: "alpha" };
const beta = { channel: "changes", scope: "beta" };
const fields = (runtime: ReturnType<typeof createRuntime>) =>
	runtime
		.readModelSnapshot()
		.records.find((record) => record.confirmed?.identity === "a")?.confirmed
		?.fields;
const fact = (extra: Partial<FactObservation> = {}): FactObservation => ({
	resource: "things",
	identity: "a",
	presence: "present",
	values: { name: "a", status: "Running" },
	basis: ["public"],
	...extra,
});
const definition: ResourceDefinition = {
	name: "things",
	access: "public",
	persist: () => true,
	persistRelationship: () => true,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("omitted and explicit undefined continuity scopes identify the same channel", () => {
	const runtime = createRuntime({ resources: [definition] });
	try {
		runtime.setContinuity({ channel: "changes" }, "live");
		runtime.observe({
			facts: [fact({ liveness: { channel: "changes", scope: undefined } })],
		});
		assert.equal(fields(runtime)?.status?.liveness, "live");
		runtime.setContinuity(
			{ channel: "changes", scope: undefined },
			"interrupted",
		);
		assert.equal(fields(runtime)?.status?.stale, true);
	} finally {
		runtime.close();
	}
});

test("field channels, identity invariants and measurements remain independent", () => {
	const runtime = createRuntime({ resources: [definition] });
	try {
		runtime.setContinuity(alpha, "live");
		runtime.setContinuity(beta, "live");
		runtime.observe({
			facts: [
				fact({
					values: { name: "a", status: "Running", notes: "Hello", cpu: 5 },
					liveness: alpha,
					fieldLiveness: { name: "immutable", notes: beta, cpu: "snapshot" },
				}),
			],
		});
		runtime.setContinuity(alpha, "interrupted");
		assert.equal(fields(runtime)?.status?.stale, true);
		assert.equal(fields(runtime)?.notes?.liveness, "live");
		assert.equal(fields(runtime)?.notes?.stale, undefined);
		assert.equal(fields(runtime)?.name?.liveness, "immutable");
		assert.equal(fields(runtime)?.name?.stale, undefined);
		assert.equal(fields(runtime)?.cpu?.liveness, "snapshot");
		assert.equal(fields(runtime)?.cpu?.stale, undefined);
	} finally {
		runtime.close();
	}
});

test("partial change feeds invalidate snapshots without promising continuous maintenance", () => {
	const runtime = createRuntime({ resources: [definition] });
	try {
		runtime.setContinuity(alpha, "live");
		const observe = () =>
			runtime.observe({
				facts: [
					fact({
						liveness: { all: [alpha, "snapshot"] },
						fieldLiveness: { name: "snapshot" },
					}),
				],
			});
		observe();
		assert.equal(fields(runtime)?.status?.liveness, "snapshot");
		runtime.setContinuity(alpha, "interrupted");
		assert.equal(fields(runtime)?.status?.stale, true);
		assert.equal(fields(runtime)?.name?.stale, undefined);
		observe();
		assert.equal(fields(runtime)?.status?.stale, undefined);
		assert.equal(fields(runtime)?.status?.liveness, "snapshot");
		runtime.setContinuity(alpha, "live");
		assert.equal(fields(runtime)?.status?.stale, true);
		observe();
		assert.equal(fields(runtime)?.status?.liveness, "snapshot");
		assert.equal(fields(runtime)?.status?.stale, undefined);
	} finally {
		runtime.close();
	}
});

test("independent equal-value supports pair permissions with their own continuity", () => {
	const runtime = createRuntime({
		resources: [definition],
		access: [
			{ scope: "a", state: "allowed" },
			{ scope: "b", state: "allowed" },
		],
	});
	try {
		runtime.setContinuity(alpha, "live");
		runtime.setContinuity(beta, "live");
		runtime.observe({
			facts: [
				fact({ basis: ["a"], liveness: alpha }),
				fact({ basis: ["b"], liveness: beta }),
			],
		});
		runtime.setContinuity(alpha, "interrupted");
		assert.equal(fields(runtime)?.status?.liveness, "live");
		assert.equal(fields(runtime)?.status?.stale, undefined);
		runtime.observe({ facts: [fact({ basis: ["b"], liveness: beta })] });
		runtime.revoke("b");
		assert.equal(fields(runtime)?.status?.stale, true);
		runtime.setContinuity(beta, "live");
		assert.equal(fields(runtime)?.status?.stale, true);
		runtime.revoke("a");
		assert.equal(fields(runtime), undefined);
	} finally {
		runtime.close();
	}
});

test("derived currency composes every input while independent direct evidence survives", () => {
	const runtime = createRuntime({ resources: [definition] });
	try {
		runtime.setContinuity(alpha, "live");
		runtime.setContinuity(beta, "live");
		runtime.observe({
			facts: [
				fact({
					values: { left: 1, right: 2 },
					liveness: alpha,
					fieldLiveness: { right: beta },
				}),
			],
		});
		runtime.observe({
			facts: [
				fact({
					presence: undefined,
					values: { sum: 3 },
					dependsOn: [
						{ resource: "things", identity: "a", field: "left" },
						{ resource: "things", identity: "a", field: "right" },
					],
				}),
			],
		});
		assert.equal(fields(runtime)?.sum?.liveness, "live");
		runtime.setContinuity(beta, "interrupted");
		assert.equal(fields(runtime)?.sum?.stale, true);
		runtime.observe({
			facts: [
				fact({ presence: undefined, values: { sum: 3 }, liveness: alpha }),
			],
		});
		assert.equal(fields(runtime)?.sum?.liveness, "live");
		assert.equal(fields(runtime)?.sum?.stale, undefined);
		runtime.observe({
			invalidate: [{ resource: "things", identity: "a", field: "right" }],
		});
		assert.equal(fields(runtime)?.sum?.stale, undefined);
	} finally {
		runtime.close();
	}
});

test("membership and relationships lose only the affected continuity", () => {
	const runtime = createRuntime({ resources: [definition] });
	try {
		runtime.setContinuity(alpha, "live");
		runtime.setContinuity(beta, "live");
		runtime.observe({
			memberships: [
				{
					resource: "things",
					scope: "alpha",
					identities: [],
					complete: true,
					basis: ["public"],
					liveness: alpha,
				},
				{
					resource: "things",
					scope: "beta",
					identities: [],
					complete: true,
					basis: ["public"],
					liveness: beta,
				},
			],
			relationships: [
				{
					resource: "things",
					identity: "a",
					relationship: "children",
					targets: [],
					complete: true,
					basis: ["public"],
					liveness: beta,
				},
			],
		});
		runtime.setContinuity(alpha, "interrupted");
		assert.equal(runtime.membership("things", "alpha")?.complete, false);
		assert.equal(runtime.membership("things", "beta")?.complete, true);
		assert.equal(
			runtime.relationship("things", "a", "children")?.complete,
			true,
		);
		runtime.setContinuity(beta, "interrupted");
		assert.equal(
			runtime.relationship("things", "a", "children")?.complete,
			false,
		);
	} finally {
		runtime.close();
	}
});

test("a late first response across a gap stays uncertain and reacquires only once", async () => {
	const first = deferred<ObservationBatch>();
	let reads = 0;
	const runtime = createRuntime({
		resources: [
			{
				...definition,
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["name", "status"],
						run: async () => {
							reads++;
							return reads === 1
								? first.promise
								: { facts: [fact({ liveness: alpha })] };
						},
					},
				],
			},
		],
	});
	try {
		runtime.setContinuity(alpha, "live");
		const result = runtime.read(
			query({
				resource: "things",
				mode: "one",
				identity: "a",
				select: ["status"],
			}),
		);
		await tick();
		assert.equal(reads, 1);
		runtime.setContinuity(alpha, "interrupted");
		first.resolve({
			facts: [fact({ values: { status: "Old" }, liveness: alpha })],
		});
		assert.equal((await result).rows[0]?.data.status, "Running");
		assert.equal(reads, 2);
		await tick();
		assert.equal(reads, 2);
		assert.equal(fields(runtime)?.status?.liveness, "snapshot");
	} finally {
		runtime.close();
	}
});

test("restoration preserves immutable permission-supported facts but never old owner continuity", async () => {
	const persistence = new MemoryPersistence();
	const first = createRuntime({ resources: [definition], persistence });
	await first.ready;
	first.setContinuity(alpha, "live");
	first.observe({
		facts: [
			fact({
				liveness: alpha,
				values: { name: "a", status: "Running", sampled: 4 },
				fieldLiveness: { name: "immutable", sampled: "snapshot" },
			}),
		],
	});
	await first.flush();
	first.close();
	const second = createRuntime({ resources: [definition], persistence });
	try {
		await second.ready;
		second.setContinuity(alpha, "live");
		assert.equal(fields(second)?.name?.liveness, "immutable");
		assert.equal(fields(second)?.name?.stale, undefined);
		assert.equal(fields(second)?.status?.stale, true);
		assert.equal(fields(second)?.sampled?.stale, true);
	} finally {
		second.close();
	}
});

test("repeated equal observations retain bounded distinct evidence supports", async () => {
	const persistence = new MemoryPersistence();
	const runtime = createRuntime({ resources: [definition], persistence });
	try {
		await runtime.ready;
		runtime.setContinuity(alpha, "live");
		runtime.setContinuity(beta, "live");
		for (let i = 0; i < 100; i++) {
			runtime.setContinuity(alpha, "interrupted");
			runtime.setContinuity(alpha, "live");
			runtime.observe({
				facts: [fact({ liveness: alpha }), fact({ liveness: beta })],
			});
		}
		await runtime.flush();
		assert.equal(
			(await persistence.load()).facts.find((entry) => entry.field === "status")
				?.supports.length,
			2,
		);
	} finally {
		runtime.close();
	}
});

test("reconnecting retries an already-stale field after its interrupted acquisition failed", async () => {
	let online = true,
		reads = 0,
		status = "Running";
	const runtime = createRuntime({
		resources: [
			{
				...definition,
				sources: [
					{
						key: "detail",
						mode: "one",
						fields: ["status"],
						run: async () => {
							reads++;
							if (!online) throw new Error("Offline");
							return { facts: [fact({ values: { status }, liveness: alpha })] };
						},
					},
				],
			},
		],
	});
	const handle = runtime.watch(
		query({
			resource: "things",
			mode: "one",
			identity: "a",
			select: ["status"],
		}),
	);
	const unsubscribe = handle.subscribe(() => {});
	try {
		runtime.setContinuity(alpha, "live");
		for (let i = 0; i < 10 && !handle.getSnapshot().settled; i++) await tick();
		assert.equal(reads, 1);
		online = false;
		runtime.setContinuity(alpha, "interrupted");
		for (let i = 0; i < 10 && !handle.getSnapshot().settled; i++) await tick();
		assert.equal(reads, 2);
		assert.equal(handle.getSnapshot().issues[0]?.kind, "read");
		online = true;
		status = "Stopped";
		runtime.setContinuity(alpha, "live");
		for (
			let i = 0;
			i < 10 && handle.getSnapshot().rows[0]?.data.status !== "Stopped";
			i++
		)
			await tick();
		assert.equal(reads, 3);
		assert.equal(handle.getSnapshot().rows[0]?.data.status, "Stopped");
		assert.equal(handle.getSnapshot().rows[0]?.fields.status?.liveness, "live");
	} finally {
		unsubscribe();
		handle.dispose();
		runtime.close();
	}
});

test("a partial enumeration does not erase independently maintained complete membership", () => {
	const runtime = createRuntime({
		resources: [definition],
		access: [
			{ scope: "complete", state: "allowed" },
			{ scope: "partial", state: "allowed" },
		],
	});
	try {
		runtime.setContinuity(alpha, "live");
		runtime.setContinuity(beta, "live");
		runtime.observe({
			memberships: [
				{
					resource: "things",
					identities: ["a"],
					complete: true,
					basis: ["complete"],
					liveness: alpha,
				},
			],
		});
		runtime.observe({
			memberships: [
				{
					resource: "things",
					identities: ["a"],
					complete: false,
					basis: ["partial"],
					liveness: beta,
				},
			],
		});
		assert.equal(runtime.membership("things")?.complete, true);
		runtime.revoke("complete");
		assert.equal(runtime.membership("things")?.complete, false);
		assert.deepEqual(runtime.membership("things")?.identities, ["a"]);
	} finally {
		runtime.close();
	}
});
