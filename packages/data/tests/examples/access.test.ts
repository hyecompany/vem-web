// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "@hyecompany/vem-data/runtime";
import {
	applySession,
	leaveAccount,
	protectedTaskFact,
	protectedTaskRead,
	withdrawNotes,
} from "../../examples/integration/access.js";
import { tasks } from "../../examples/task-board/contract.js";

test("documented permissions withdraw notes while preserving public fields and cannot restore retired values", (t) => {
	const runtime = createRuntime({ resources: [protectedTaskRead] });
	t.after(() => runtime.close());
	const session = { subject: "alice", canReadNotes: true, canEditTasks: true };
	applySession(runtime, session);
	runtime.observe({
		facts: [
			protectedTaskFact({
				id: "walk",
				title: "Walk",
				status: "open",
				notes: "Private location",
			}),
		],
	});
	const view = runtime.watch(
		tasks.get({ id: "walk" }, { select: ["title", "notes"] }),
	);
	t.after(() => view.dispose());
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Private location");
	runtime.revoke("tasks:write");
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "Private location");
	withdrawNotes(runtime);
	assert.equal(view.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	applySession(runtime, session);
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
	runtime.observe({
		facts: [
			protectedTaskFact({
				id: "walk",
				title: "Walk",
				status: "open",
				notes: "New permission",
			}),
		],
	});
	assert.equal(view.getSnapshot().rows[0]?.data.notes, "New permission");
	leaveAccount(runtime);
	assert.equal(view.getSnapshot().rows[0]?.data.title, "Walk");
	assert.equal(view.getSnapshot().rows[0]?.data.notes, undefined);
});
