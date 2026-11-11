// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { AccessRegistry } from "../../src/access.js";
import { KnowledgeStore } from "../../src/runtime/knowledge.js";
import type { Cell } from "../../src/runtime/state.js";
import { createRuntime } from "../../src/runtime.js";
import type { FactObservation } from "../../src/types.js";

const ref = (identity: string) => ({
	resource: "things",
	identity,
	field: "value",
});
const fact = (
	identity: string,
	extra: Partial<FactObservation> = {},
): FactObservation => ({
	resource: "things",
	identity,
	values: { value: identity },
	basis: ["public"],
	liveness: "immutable",
	...extra,
});
const fields = (runtime: ReturnType<typeof createRuntime>, identity: string) =>
	runtime
		.readModelSnapshot()
		.records.find((record) => record.confirmed?.identity === identity)
		?.confirmed?.fields;

test("ordinary observations reconsider only changed cells and identical evidence schedules no currency work", (t) => {
	const runtime = createRuntime({ resources: [{ name: "things" }] });
	t.after(() => runtime.close());
	runtime.observe({
		facts: Array.from({ length: 200 }, (_, index) => fact(String(index))),
	});
	const seen: unknown[] = [];
	const currency = KnowledgeStore.prototype.currency;
	t.mock.method(
		KnowledgeStore.prototype,
		"currency",
		function (this: KnowledgeStore, ...args: Parameters<typeof currency>) {
			seen.push(args[0].identity);
			return currency.apply(this, args);
		},
	);
	runtime.observe({ facts: [fact("0", { values: { value: "updated" } })] });
	assert.deepEqual(seen, ["0"]);
	seen.length = 0;
	runtime.observe({ facts: [fact("0", { values: { value: "updated" } })] });
	assert.deepEqual(seen, []);
	runtime.observe({ facts: [fact("0", { values: {}, replace: ["value"] })] });
	assert.deepEqual(seen, []);
});

test("ordinary repairs propagate through dependent chains while independent evidence remains current", (t) => {
	const channel = { channel: "events" };
	const runtime = createRuntime({
		resources: [{ name: "things" }],
		access: [{ scope: "alternate", state: "allowed" }],
	});
	t.after(() => runtime.close());
	runtime.setContinuity(channel, "live");
	runtime.observe({
		facts: [
			...Array.from({ length: 100 }, (_, index) => fact(`unrelated-${index}`)),
			fact("source", { liveness: channel }),
			fact("middle", { dependsOn: [ref("source")] }),
			fact("leaf", { dependsOn: [ref("middle")] }),
			fact("independent", { dependsOn: [ref("source")] }),
		],
	});
	runtime.observe({ facts: [fact("independent", { basis: ["alternate"] })] });
	runtime.setContinuity(channel, "interrupted");
	assert.equal(fields(runtime, "middle")?.value?.stale, true);
	assert.equal(fields(runtime, "leaf")?.value?.stale, true);
	assert.equal(fields(runtime, "independent")?.value?.stale, undefined);
	runtime.setContinuity(channel, "live");
	const seen: unknown[] = [];
	const currency = KnowledgeStore.prototype.currency;
	t.mock.method(
		KnowledgeStore.prototype,
		"currency",
		function (this: KnowledgeStore, ...args: Parameters<typeof currency>) {
			seen.push(args[0].identity);
			return currency.apply(this, args);
		},
	);
	runtime.observe({ facts: [fact("source", { liveness: channel })] });
	assert.deepEqual(seen, ["source", "middle", "leaf", "independent"]);
	assert.equal(fields(runtime, "middle")?.value?.stale, undefined);
	assert.equal(fields(runtime, "leaf")?.value?.stale, undefined);
	assert.equal(fields(runtime, "leaf")?.value?.liveness, "live");
	assert.equal(fields(runtime, "independent")?.value?.liveness, "immutable");
	seen.length = 0;
	runtime.observe({ facts: [fact("source", { liveness: channel })] });
	assert.deepEqual(seen, []);
	runtime.setContinuity(channel, "interrupted");
	runtime.revoke("alternate");
	assert.equal(fields(runtime, "independent")?.value?.stale, true);
	assert.ok(fields(runtime, "independent")?.value);
});

test("dependency indexing handles cycles, support-only edges, removals, replacements and close", (t) => {
	const grants = new AccessRegistry();
	const store = new KnowledgeStore(
		new Map([["things", { name: "things" }]]),
		grants,
		() => {},
	);
	t.after(() => {
		store.close();
		grants.close();
	});
	const cell = (
		key: string,
		dependencies: string[] = [],
		supportOnly = false,
	): Cell => ({
		key,
		resource: "things",
		identity: key,
		field: "value",
		value: key,
		bases: [grants.ref("public")],
		dependencies: supportOnly ? [] : dependencies,
		supports: [
			{
				bases: [grants.ref("public")],
				dependencies,
				independentDisclosure: true,
				liveness: "immutable",
			},
		],
		liveness: "snapshot",
		source: "derived",
		revision: ++store.revision,
	});
	store.putCell(cell("a", ["b"]));
	store.putCell(cell("b", ["a"], true));
	store.refreshCurrency();
	assert.equal(store.cells.get("a")?.stale, true);
	assert.equal(store.cells.get("b")?.stale, true);
	store.putCell(cell("a"));
	store.refreshCurrency();
	assert.equal(store.cells.get("a")?.stale, false);
	assert.equal(store.cells.get("b")?.stale, false);
	store.putCell(cell("c", ["b"]));
	store.refreshCurrency();
	store.dropCell("a");
	assert.deepEqual(
		store.dependents(["a"]).map((value) => value.key),
		["b"],
	);
	store.refreshCurrency();
	assert.equal(store.cells.get("b")?.stale, true);
	assert.equal(store.cells.get("c")?.stale, true);
	store.putCell(cell("a"));
	store.refreshCurrency();
	assert.equal(store.cells.get("b")?.stale, false);
	assert.equal(store.cells.get("c")?.stale, false);
	store.putCell(cell("b"));
	store.refreshCurrency();
	assert.deepEqual(store.dependents(["a"]), []);
	store.dropCell("a");
	assert.deepEqual(store.refreshCurrency(), []);
	assert.equal(store.cells.get("b")?.stale, false);
	assert.equal(store.cells.get("c")?.stale, false);
	store.close();
	assert.deepEqual(store.dependents(["a", "b", "c"]), []);
	assert.deepEqual(store.refreshCurrency(), []);
});
