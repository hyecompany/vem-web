// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import AxeBuilder from "@axe-core/playwright";
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
	const context = await engine.newContext(options),
		page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(`${app.url}/docs/data/connect/events`);
		await run(
			page,
			page.getByRole("region", {
				name: "Different fields, different guarantees",
				exact: true,
			}),
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
}
const field = (lab, name) => lab.locator(`[data-currency-field="${name}"]`);
const history = (lab) =>
	lab.getByRole("region", { name: "Field read history", exact: true });
test("a scoped continuity gap reacquires only the supported title, preserving immutable and snapshot fields", async () =>
	visit(async (_page, lab) => {
		await expect(field(lab, "id")).toContainText("Immutable");
		await expect(field(lab, "title")).toContainText("Live");
		await expect(field(lab, "temperature")).toContainText("18°C");
		await expect(field(lab, "temperature")).toContainText("Snapshot");
		await expect(history(lab).locator("li")).toHaveCount(1);
		await lab.getByRole("button", { name: "Go offline", exact: true }).click();
		await expect(field(lab, "title")).toContainText("Last known");
		await expect(history(lab).locator('li[data-state="failed"]')).toHaveCount(
			1,
		);
		await expect(history(lab).locator("li").last()).toContainText("Title");
		await expect(history(lab).locator("li").last()).not.toContainText(
			"Temperature",
		);
		await expect(field(lab, "id")).toContainText("Immutable");
		await expect(field(lab, "temperature")).toContainText("Snapshot");
		await lab
			.getByRole("button", { name: "Change the service", exact: true })
			.click();
		await expect(history(lab)).toContainText("Walk by the lake");
		await expect(history(lab)).toContainText("21°C");
		await expect(field(lab, "title")).toContainText("Plan a weekend walk");
		await expect(field(lab, "temperature")).toContainText("18°C");
		await lab.getByRole("button", { name: "Reconnect", exact: true }).click();
		await expect(field(lab, "title")).toContainText("Plan a weekend walk");
		await expect(field(lab, "title")).toContainText("Checking…");
		await expect(field(lab, "title")).not.toContainText("Reading…");
		await expect(history(lab).locator('li[data-state="reading"]')).toHaveCount(
			1,
		);
		await lab
			.getByRole("button", { name: "Return an error", exact: true })
			.click();
		await expect(field(lab, "title")).toContainText("Plan a weekend walk");
		await expect(field(lab, "title")).toContainText("Last known");
		await expect(field(lab, "title")).not.toContainText("Checking…");
		await expect(history(lab).locator('li[data-state="reading"]')).toHaveCount(
			0,
		);
		await lab.getByRole("button", { name: "Try again", exact: true }).click();
		await expect(field(lab, "title")).toContainText("Checking…");
		await expect(field(lab, "title")).toContainText("Plan a weekend walk");
		await lab
			.getByRole("button", { name: "Let the service reply", exact: true })
			.click();
		await expect(field(lab, "title")).toContainText("Walk by the lake");
		await expect(field(lab, "title")).toContainText("Live");
		await expect(field(lab, "title")).not.toContainText("Last known");
		await expect(field(lab, "temperature")).toContainText("18°C");
		await expect(field(lab, "temperature")).toContainText("Snapshot");
		await expect(history(lab).locator("li")).toHaveCount(4);
		await expect(history(lab).locator("li").last()).not.toContainText(
			"Task ID",
		);
		await expect(history(lab).locator("li").last()).not.toContainText(
			"Temperature",
		);
		await lab.getByRole("button", { name: "Start over", exact: true }).click();
		await expect(history(lab).locator("li")).toHaveCount(1);
		await expect(field(lab, "title")).toContainText("Plan a weekend walk");
	}));
test("per-field currency remains understandable and keyboard accessible on mobile", async () =>
	visit(
		async (page, lab) => {
			const offline = lab.getByRole("button", {
				name: "Go offline",
				exact: true,
			});
			await offline.focus();
			await page.keyboard.press("Enter");
			await expect(field(lab, "title")).toContainText("Last known");
			assert.ok(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			);
			const result = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
				.analyze();
			assert.deepEqual(result.violations, []);
			await lab
				.getByRole("button", { name: "Change the service", exact: true })
				.click();
			await lab.getByRole("button", { name: "Reconnect", exact: true }).click();
			await expect(field(lab, "title")).toContainText("Checking…");
			await expect(field(lab, "title")).toContainText("Plan a weekend walk");
			await lab
				.getByRole("button", { name: "Start over", exact: true })
				.click();
			await expect(field(lab, "title")).toContainText("Live");
		},
		{ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" },
	));
