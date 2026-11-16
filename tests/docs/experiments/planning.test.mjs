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
		await page.goto(`${app.url}/docs/data/connect/planning`);
		const lab = page.getByRole("region", {
			name: "One plan for several views",
			exact: true,
		});
		await run(page, lab);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
}
const receipt = (lab) =>
	lab.getByRole("region", { name: "Service reads", exact: true });
test("planning compares combined note views and reuses previously acquired fields", async () =>
	visit(async (_page, lab) => {
		const notesToggle = lab.getByRole("button", {
			name: "Open Plan a weekend walk notes",
			exact: true,
		});
		await expect(notesToggle).toHaveAttribute("aria-expanded", "false");
		await expect(receipt(lab).locator("li")).toHaveCount(1);
		await lab
			.getByRole("button", { name: "Open all notes", exact: true })
			.click();
		await expect(lab.locator(".planning-note")).toHaveCount(3);
		await expect(lab).toContainText(
			"Bring a raincoat if showers are forecast.",
		);
		await expect(receipt(lab).locator('li[data-source="all"]')).toHaveCount(1);
		await expect(receipt(lab).locator("li")).toHaveCount(2);
		await lab.getByRole("button", { name: "Start over", exact: true }).click();
		await expect(receipt(lab).locator("li")).toHaveCount(1);
		await lab
			.getByRole("button", {
				name: "Open Plan a weekend walk notes",
				exact: true,
			})
			.click();
		await expect(lab).toContainText("Meet at 10 by the river.");
		const closeNotes = lab.getByRole("button", {
			name: "Close Plan a weekend walk notes",
			exact: true,
		});
		await expect(closeNotes).toHaveAttribute("aria-expanded", "true");
		const controlledId = await closeNotes.getAttribute("aria-controls");
		assert.ok(controlledId);
		await expect(lab.locator(`[id="${controlledId}"]`)).toContainText(
			"Meet at 10 by the river.",
		);
		await expect(receipt(lab).locator('li[data-source="one"]')).toHaveCount(1);
		await expect(receipt(lab).locator("li")).toHaveCount(2);
		await lab
			.getByRole("button", {
				name: "Close Plan a weekend walk notes",
				exact: true,
			})
			.click();
		await lab
			.getByRole("button", {
				name: "Open Plan a weekend walk notes",
				exact: true,
			})
			.click();
		await expect(lab).toContainText("Meet at 10 by the river.");
		await expect(receipt(lab).locator("li")).toHaveCount(2);
	}));
test("another note consumer joins the held collection reply without another source call", async () =>
	visit(async (_page, lab) => {
		await lab.getByRole("tab", { name: "Share a reply", exact: true }).click();
		const panel = lab.getByRole("tabpanel", {
			name: "Share a reply",
			exact: true,
		});
		await panel
			.getByRole("button", { name: "Open all notes", exact: true })
			.click();
		await expect(
			receipt(panel).locator('li[data-source="all"][data-state="reading"]'),
		).toHaveCount(1);
		await panel
			.getByRole("button", { name: "Open notes overview", exact: true })
			.click();
		await expect(
			panel.getByRole("complementary", { name: "Notes overview" }),
		).toContainText("0 of 3 notes ready");
		await expect(receipt(panel).locator("li")).toHaveCount(2);
		await panel
			.getByRole("button", { name: "Let the service reply", exact: true })
			.click();
		await expect(
			panel.getByRole("complementary", { name: "Notes overview" }),
		).toContainText("3 of 3 notes ready");
		await expect(receipt(panel).locator("li")).toHaveCount(2);
		await expect(
			panel.getByText("Reading notes…", { exact: true }),
		).toHaveCount(0);
		await lab.getByRole("button", { name: "Start over", exact: true }).click();
		await expect(receipt(lab).locator("li")).toHaveCount(1);
	}));
test("filtered paging keeps partial tasks visible then compares broader demand", async () =>
	visit(async (_page, lab) => {
		await lab
			.getByRole("tab", { name: "Filter and pages", exact: true })
			.click();
		const panel = lab.getByRole("tabpanel", {
			name: "Filter and pages",
			exact: true,
		});
		await expect(panel).toContainText("1 task so far");
		await expect(receipt(panel).locator('li[data-source="page"]')).toHaveCount(
			2,
		);
		await expect(panel).toContainText("Plan a weekend walk");
		await expect(panel.getByText("Pack a picnic", { exact: true })).toHaveCount(
			0,
		);
		await panel
			.getByRole("button", { name: "Let the service reply", exact: true })
			.click();
		await expect(panel).toContainText("2 tasks · complete");
		await expect(panel).toContainText("Check the weather");
		await panel.getByRole("button", { name: "All tasks", exact: true }).click();
		await expect(panel).toContainText("3 tasks · complete");
		await expect(receipt(panel).locator('li[data-source="all"]')).toHaveCount(
			1,
		);
		await expect(receipt(panel).locator("li")).toHaveCount(3);
		await panel.getByRole("button", { name: "To do", exact: true }).click();
		await expect(panel).toContainText("2 tasks · complete");
		await expect(receipt(panel).locator("li")).toHaveCount(3);
	}));
test("planning lesson supports keyboard controls, reduced motion, and small screens", async () =>
	visit(
		async (page, lab) => {
			const sharing = lab.getByRole("tab", {
				name: "Share a reply",
				exact: true,
			});
			await sharing.focus();
			await page.keyboard.press("Enter");
			await expect(sharing).toHaveAttribute("aria-selected", "true");
			const panel = lab.getByRole("tabpanel", {
				name: "Share a reply",
				exact: true,
			});
			await panel
				.getByRole("button", { name: "Open all notes", exact: true })
				.click();
			await expect(
				receipt(panel).locator('li[data-state="reading"]'),
			).toHaveCount(1);
			await expect(
				receipt(panel).locator('li[data-state="reading"] svg'),
			).toHaveCSS("animation-name", "none");
			assert.ok(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			);
			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
				.analyze();
			assert.deepEqual(results.violations, []);
			await lab
				.getByRole("button", { name: "Start over", exact: true })
				.click();
			await expect(receipt(lab).locator("li")).toHaveCount(1);
		},
		{ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" },
	));

test("a failed collection read falls back through the actual planner and reset clears the attempt", async () =>
	visit(async (_page, lab) => {
		await lab.getByRole("tab", { name: "Share a reply", exact: true }).click();
		const panel = lab.getByRole("tabpanel", {
			name: "Share a reply",
			exact: true,
		});
		await panel
			.getByRole("button", { name: "Open all notes", exact: true })
			.click();
		await panel
			.getByRole("button", { name: "Return an error", exact: true })
			.click();
		await expect(
			receipt(panel).locator('li[data-source="all"][data-state="failed"]'),
		).toHaveCount(1);
		await expect(
			receipt(panel).locator('li[data-source="one"][data-state="finished"]'),
		).toHaveCount(3);
		await expect(panel).toContainText("Meet at 10 by the river.");
		await expect(panel).toContainText(
			"Bring a raincoat if showers are forecast.",
		);
		await lab.getByRole("button", { name: "Start over", exact: true }).click();
		await expect(receipt(lab).locator("li")).toHaveCount(1);
		await expect(receipt(lab).locator('li[data-state="failed"]')).toHaveCount(
			0,
		);
	}));
