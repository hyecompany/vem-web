// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { command, query } from "../../src/descriptors.js";
import { createTestClient } from "../../src/testing.js";

test("feature fixtures exercise partial rows and typed command outcomes without an adapter", async () => {
	const descriptor = query<{ name: string; status: string }, string>({
		resource: "things",
		mode: "list",
		select: ["name", "status"],
	});
	const submit = command({
		resource: "things",
		name: "start",
		target: "a",
		input: {},
	});
	const fixtures = createTestClient({
		queries: [
			{ query: descriptor, rows: [{ identity: "a", data: { name: "A" } }] },
		],
		commands: [
			{
				command: submit,
				outcome: { kind: "partial", value: { started: true, attached: false } },
			},
		],
	});
	const snapshot = await fixtures.client.read(descriptor);
	assert.equal(snapshot.rows[0]?.complete, false);
	assert.equal(snapshot.confirmed.total, 1);
	assert.equal((await fixtures.client.run(submit).result).kind, "partial");
	assert.equal(fixtures.calls.length, 1);
	fixtures.close();
});
