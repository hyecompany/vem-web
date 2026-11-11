// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionOutcome } from "@hyecompany/vem-data";
import { DataProvider } from "@hyecompany/vem-data/react";
import { createTestClient } from "@hyecompany/vem-data/testing";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionFeedback } from "../../examples/feature-guide/actions.js";
import { TaskDetail } from "../../examples/feature-guide/detail.js";
import {
	renderPartialList,
	showFailure,
} from "../../examples/feature-guide/testing.js";
import { tasks } from "../../examples/task-board/contract.js";

const target = { id: "walk" };
test("documented list keeps a partial task visible beside a source failure", async (t) => {
	let view: ReactNode;
	const fixture = renderPartialList((element) => {
		view = element;
	});
	t.after(() => fixture.close());
	let html = renderToStaticMarkup(view);
	assert.match(html, /Plan a weekend walk/);
	assert.match(html, /Status unavailable/);
	assert.doesNotMatch(html, /No matching tasks/);
	showFailure(fixture);
	await fixture.client.read(
		tasks.list({ select: ["title", "status"], where: undefined }),
	);
	html = renderToStaticMarkup(view);
	assert.match(html, /Plan a weekend walk/);
	assert.match(html, /The task service is unavailable/);
	assert.match(html, /Try again/);
});

test("documented detail distinguishes absent resources from missing display fields", async (t) => {
	const query = tasks.get(target, { select: ["title", "notes"] });
	const fixture = createTestClient({
		queries: [
			{
				query,
				rows: [{ identity: target, data: { title: "Plan a weekend walk" } }],
				exists: true,
			},
		],
	});
	t.after(() => fixture.close());
	const render = () =>
		renderToStaticMarkup(
			DataProvider({
				client: fixture.client,
				children: createElement(TaskDetail, { target }),
			}),
		);
	assert.match(render(), /Notes unavailable/);
	assert.doesNotMatch(render(), /no longer exists/);
	const absent = createTestClient({ queries: [{ query, exists: false }] });
	t.after(() => absent.close());
	const missing = renderToStaticMarkup(
		DataProvider({
			client: absent.client,
			children: createElement(TaskDetail, { target }),
		}),
	);
	assert.match(missing, /This task no longer exists/);
});

test("documented action feedback preserves outcome meaning and exposes only permitted retry", async () => {
	const cases: { outcome: ActionOutcome; message: string; retry: boolean }[] = [
		{
			outcome: { kind: "succeeded" },
			message: "Task completed.",
			retry: false,
		},
		{
			outcome: {
				kind: "partial",
				value: { savedNotes: true },
				message: "Notes saved; task still open.",
			},
			message: "Notes saved; task still open.",
			retry: false,
		},
		{
			outcome: {
				kind: "failed",
				submitted: false,
				error: { message: "Rejected before submission." },
			},
			message: "Rejected before submission.",
			retry: true,
		},
		{
			outcome: { kind: "unknown", message: "The response was lost." },
			message: "The response was lost.",
			retry: false,
		},
	];
	for (const item of cases) {
		const command = tasks.commands.complete(target);
		const fixture = createTestClient({
			commands: [{ command, outcome: item.outcome }],
		});
		try {
			const action = fixture.client.run(command);
			await action.result;
			const html = renderToStaticMarkup(
				createElement(ActionFeedback, { action, onRetry: () => undefined }),
			);
			assert.ok(html.includes(item.message));
			assert.equal(html.includes("Try again"), item.retry);
			assert.equal(fixture.calls.length, 1);
		} finally {
			fixture.close();
		}
	}
});
