// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { expect } from "@playwright/test";
export async function starterJourney(start, browser) {
	const app = await start(0);
	const context = await browser.newContext();
	const errors = [];
	context.on("page", (page) =>
		page.on("pageerror", (error) => errors.push(error.message)),
	);
	const releaseReads = app.fixture.holdTaskReads();
	const reads = () =>
		app.fixture.requests.filter(
			(request) => request.method === "GET" && request.path === "/api/tasks",
		).length;
	try {
		const first = await context.newPage();
		await first.goto(app.url);
		await expect(first.getByText("Connection: ready")).toBeVisible();
		await expect.poll(reads).toBe(1);
		await expect(first.getByText("Reading missing information…")).toBeVisible();
		const second = await context.newPage();
		await second.goto(`${app.url}?view=notes`);
		await expect(
			second.getByRole("heading", { name: "Task notes" }),
		).toBeVisible();
		await expect(
			second.getByText("Reading missing information…"),
		).toBeVisible();
		assert.equal(
			reads(),
			1,
			"different selections joined the same in-flight HTTP read",
		);
		releaseReads();
		await expect(first.getByText("2 confirmed matches")).toBeVisible();
		await expect(
			second.getByText("Try editing these notes.", { exact: true }),
		).toBeVisible();
		assert.equal(
			reads(),
			1,
			"the collection representation satisfied both tabs",
		);
		await expect
			.poll(
				() =>
					app.fixture.requests.filter((r) => r.path === "/api/events").length,
			)
			.toBe(1);
		assert.ok(reads() > 0, "real list acquisition occurred");
		const initial = reads();
		await first.evaluate(() => {
			window.loadingFlashes = [];
			new MutationObserver(() => {
				if (document.body.textContent.includes("Reading missing information"))
					window.loadingFlashes.push(true);
			}).observe(document.querySelector("main"), {
				subtree: true,
				childList: true,
				characterData: true,
			});
		});
		await first.getByLabel("Open tasks only").check();
		await first.getByLabel("Open tasks only").uncheck();
		assert.deepEqual(
			await first.evaluate(() => window.loadingFlashes),
			[],
			"known filters did not flash loading",
		);
		await second.goto(app.url);
		await expect(second.getByText("2 confirmed matches")).toBeVisible();
		assert.equal(reads(), initial, "second tab reused owner knowledge");
		assert.equal(
			app.fixture.requests.filter((r) => r.path === "/api/events").length,
			1,
			"one actual owner event stream",
		);
		await first.reload();
		await expect(first.getByText("2 confirmed matches")).toBeVisible();
		assert.equal(reads(), initial, "reload reused the surviving owner");
		// Exercise the persisted lifecycle branch even when this browser skips bfcache.
		await first.evaluate(() => {
			window.dispatchEvent(
				new PageTransitionEvent("pagehide", { persisted: true }),
			);
			window.dispatchEvent(
				new PageTransitionEvent("pageshow", { persisted: true }),
			);
		});
		await expect(first.getByText("Connection: ready")).toBeVisible();
		await first.getByRole("button", { name: "Complete task" }).first().click();
		await expect(second.locator(".task-list li").first()).toContainText("done");
		await first.getByRole("button", { name: "Edit notes" }).first().click();
		await expect(
			first.getByRole("textbox", { name: "Notes", exact: true }),
		).toHaveValue("Try editing these notes.");
		await first
			.getByRole("textbox", { name: "Notes", exact: true })
			.fill("My protected draft");
		await first.getByText("Try an external update", { exact: true }).click();
		await first.getByRole("button", { name: "Change server notes" }).click();
		await expect
			.poll(() =>
				app.fixture.requests.some((r) => r.path === "/api/external-change"),
			)
			.toBe(true);
		await first
			.getByRole("button", { name: "Save notes", exact: true })
			.click();
		await expect(first.getByRole("alert")).toContainText(
			"Your draft is preserved",
		);
		await expect(
			first.getByRole("textbox", { name: "Notes", exact: true }),
		).toHaveValue("My protected draft");
		await first
			.getByRole("button", { name: "Discard draft and reload" })
			.click();
		await expect(
			first.getByRole("textbox", { name: "Notes", exact: true }),
		).toHaveValue("Changed by another collaborator");
		await first
			.getByRole("textbox", { name: "Notes", exact: true })
			.fill("Saved from the independent consumer");
		await first
			.getByRole("button", { name: "Save notes", exact: true })
			.click();
		await expect(first.getByText("Saved.", { exact: true })).toBeVisible();
		await second.getByRole("button", { name: "Edit notes" }).first().click();
		await expect(
			second.getByRole("textbox", { name: "Notes", exact: true }),
		).toHaveValue("Saved from the independent consumer");
		await first.evaluate(() => {
			window.dispatchEvent(
				new PageTransitionEvent("pagehide", { persisted: false }),
			);
		});
		await expect(first.getByText("Connection: closed")).toBeVisible();
		await expect(second.getByText("Connection: ready")).toBeVisible();
		assert.deepEqual(errors, [], "starter had no browser exceptions");
		return {
			listReads: reads(),
			eventConnections: app.fixture.requests.filter(
				(r) => r.path === "/api/events",
			).length,
		};
	} finally {
		releaseReads();
		await context.close();
		await app.close();
	}
}
