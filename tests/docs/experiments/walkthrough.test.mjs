// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { expect } from "@playwright/test";
import { browser } from "../../support/browser.mjs";
import { serve } from "../support/site.mjs";

let app, engine;
before(async () => {
	app = await serve();
	engine = await browser();
});
after(async () => {
	await engine?.close();
	await app?.close();
});
async function visit(run, options = {}) {
	const context = await engine.newContext(options);
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(`${app.url}/docs/data/start/quickstart`);
		await run(page);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
}
test("a newcomer can learn three behaviors through the application while offline", async () =>
	visit(async (page) => {
		const tour = page.locator(".lesson-tour");
		await expect(tour).toContainText("1 service read");
		await page.context().setOffline(true);
		await tour.getByRole("button", { name: "To do", exact: true }).click();
		await expect(tour).not.toContainText("Pack a picnic");
		await expect(tour).toContainText("1 service read");
		await tour.getByRole("button", { name: "Overview", exact: true }).click();
		await expect(tour).toContainText("1 of 2");
		await tour.getByRole("button", { name: "Next: finish a task" }).click();
		await expect(
			tour.getByRole("tab", { name: /Finish a task/ }),
		).toBeFocused();
		await tour
			.getByRole("button", {
				name: "Complete Plan a weekend walk",
				exact: true,
			})
			.click();
		await expect(tour).toContainText("Unconfirmed");
		await tour.getByRole("button", { name: "Confirm completion" }).click();
		await expect(tour).toContainText("Task completed.");
		await tour.getByRole("button", { name: "Next: edit a task" }).click();
		const notes = tour.getByRole("textbox", { name: "Notes", exact: true });
		await expect(notes).toHaveValue("Meet at 10 by the river.");
		await notes.fill("Meet at noon");
		await tour
			.getByRole("button", { name: "Save changes", exact: true })
			.click();
		await expect(tour.getByRole("status")).toContainText("Saved");
		await tour.getByRole("button", { name: "Start over" }).click();
		await expect(notes).toHaveValue("Meet at 10 by the river.");
		await tour.getByRole("tab", { name: /Find a task/ }).click();
		await expect(tour).toContainText("1 service read");
	}));
test("the walkthrough and deeper explanations remain available without JavaScript", async () =>
	visit(
		async (page) => {
			await expect(
				page.getByRole("heading", { name: "What you just used" }),
			).toBeVisible();
			await expect(page.locator("pre").first()).toContainText("useQuery");
			await page
				.getByText("Where the application ends and the integration begins", {
					exact: true,
				})
				.click();
			const flow = page.getByRole("figure", { name: "Three responsibilities" });
			await expect(flow).toContainText("Define how backend responses");
			await expect(flow.getByRole("button")).toHaveCount(0);
		},
		{ javaScriptEnabled: false },
	));
test("walkthrough fits mobile and keyboard navigation; advanced controls stay optional", async () => {
	for (const width of [360, 640, 1280])
		await visit(
			async (page) => {
				const tour = page.locator(".lesson-tour");
				await expect(
					tour.getByRole("button", { name: "To do", exact: true }),
				).toBeVisible();
				await tour.getByRole("tab", { name: /Find a task/ }).focus();
				await page.keyboard.press("ArrowRight");
				await expect(
					tour.getByRole("tab", { name: /Finish a task/ }),
				).toHaveAttribute("aria-selected", "true");
				await tour
					.getByRole("button", {
						name: "Complete Plan a weekend walk",
						exact: true,
					})
					.click();
				await expect(
					tour.getByRole("button", { name: "Reject the change" }),
				).toBeHidden();
				await tour.getByText("Try another reply", { exact: true }).click();
				await expect(
					tour.getByRole("button", { name: "Reject the change" }),
				).toBeVisible();
				await tour.getByRole("tab", { name: /Edit a task/ }).click();
				await expect(
					tour.getByRole("textbox", { name: "Notes", exact: true }),
				).toBeVisible();
				await page
					.getByText("Where the application ends and the integration begins", {
						exact: true,
					})
					.click();
				const flow = page.getByRole("figure", {
					name: "Three responsibilities",
				});
				await expect(flow).toContainText("Define how backend responses");
				await expect(flow.getByRole("button")).toHaveCount(0);
				assert.ok(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				);
			},
			{ viewport: { width, height: 900 }, reducedMotion: "reduce" },
		);
});
