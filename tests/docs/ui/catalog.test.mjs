// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { browser } from "../../support/browser.mjs";
import { root, serve } from "../support/site.mjs";

async function visit(run, options = {}) {
	const app = await serve(),
		engine = await browser();
	const context = await engine.newContext(options),
		page = await context.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error")
			errors.push(`${message.text()} (${message.location().url})`);
	});
	try {
		await run(page, app.url);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
		await engine.close();
		await app.close();
	}
}
async function capture(page, name) {
	const directory = resolve(root, "packages/docs/.generated/screenshots");
	await mkdir(directory, { recursive: true });
	await page.screenshot({ path: resolve(directory, name), fullPage: true });
}

test("framework overview treats Data and UI equally and the combined task board uses public controls", async () =>
	visit(async (page, url) => {
		await page.goto(`${url}/docs/`);
		const main = page.locator("main");
		await expect(main).not.toContainText("Working with data");
		await expect(
			main.getByRole("link", { name: "Vem Data", exact: true }),
		).toBeVisible();
		await expect(
			main.getByRole("link", { name: "Vem UI", exact: true }),
		).toBeVisible();
		await capture(page, "framework-overview.png");
		await main
			.getByRole("link", { name: "Explore the task board", exact: true })
			.click();
		await expect(page).toHaveURL(`${url}/docs/task-board/`);
		await expect(
			page.locator(".lesson-tour [data-slot='tabs-trigger']"),
		).toHaveCount(3);
		await expect(
			page.locator(".lesson-tour [data-slot='button']").first(),
		).toBeVisible();
		await expect(page.locator(".lesson-tour")).toContainText("1 service read");
		await capture(page, "task-board-shared-ui.png");
	}));

test("component guides render package-backed previews without runtime or asset errors", async () =>
	visit(async (page, url) => {
		for (const [slug, name] of [
			["button", "Button"],
			["input", "Input"],
			["textarea", "Textarea"],
			["switch", "Switch"],
			["tabs", "Tabs"],
			["badge", "Badge"],
			["card", "Card"],
			["separator", "Separator"],
			["tooltip", "Tooltip"],
			["virtual-list", "Virtual list"],
			["sidebar", "Sidebar"],
			["input-group", "Input group"],
			["sheet", "Sheet"],
			["skeleton", "Skeleton"],
			["breadcrumb", "Breadcrumb"],
			["toast", "Toasts"],
		]) {
			await page.goto(`${url}/docs/ui/components/${slug}/`);
			const preview = page.getByRole("figure", {
				name: `${name} example`,
				exact: true,
			});
			await expect(preview).toBeVisible();
			await expect(
				preview.getByRole("button", { name: "Reset", exact: true }),
			).toBeVisible();
			await expect(
				preview.locator(".component-preview-body > *").first(),
			).toBeVisible();
			if (slug === "virtual-list") {
				await expect(
					preview.getByRole("list", { name: "Tasks" }),
				).toBeVisible();
				await preview.getByRole("switch", { name: "Show notes" }).click();
				await expect(
					preview.getByText("Pick a day that works for everyone.").first(),
				).toBeVisible();
				assert.ok((await preview.getByRole("listitem").count()) < 30);
				await capture(page, "virtual-list-desktop.png");
				await preview
					.getByRole("button", { name: "Reset", exact: true })
					.click();
				await expect(
					preview.getByRole("switch", { name: "Show notes" }),
				).not.toBeChecked();
			}
			if (slug === "sidebar") {
				await preview
					.getByRole("button", { name: "Expand Plans", exact: true })
					.click();
				await expect(
					preview.getByRole("link", { name: "Weekend walk", exact: true }),
				).toBeVisible();
				await expect(page).toHaveURL(`${url}/docs/ui/components/sidebar/`);
				await preview
					.getByRole("button", { name: "Collapse Plans", exact: true })
					.click();
				await expect(
					preview.getByRole("link", { name: "Weekend walk", exact: true }),
				).toBeHidden();
			}
			if (slug === "sheet") {
				const trigger = preview.getByRole("button", {
					name: "Board details",
					exact: true,
				});
				await trigger.click();
				const dialog = page.getByRole("dialog", { name: "Weekend board" });
				await expect(dialog).toBeVisible();
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
			}
			if (slug === "toast") {
				await preview
					.getByRole("button", { name: "Save task", exact: true })
					.click();
				await expect(page.locator('[data-slot="toast"]')).toContainText(
					"Task saved",
				);
				await preview
					.getByRole("button", { name: "Reset", exact: true })
					.click();
				await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
			}
		}
		await page.goto(`${url}/docs/ui/components/`);
		await capture(page, "ui-component-catalog.png");
	}));

test("combobox preview respects keyboard selection, accents, reset, and the docs theme in its portal", async () => {
	for (const options of [
		{ viewport: { width: 1280, height: 900 }, colorScheme: "light" },
		{
			viewport: { width: 390, height: 844 },
			colorScheme: "dark",
			reducedMotion: "reduce",
			hasTouch: true,
		},
	])
		await visit(async (page, url) => {
			await page.goto(`${url}/docs/ui/components/combobox/`);
			const preview = page.getByRole("figure", {
				name: "Combobox example",
				exact: true,
			});
			const trigger = preview.getByRole("combobox", {
				name: "Choose a board",
				exact: true,
			});
			await trigger.click();
			const search = trigger;
			await search.fill("sao");
			await expect(page.getByRole("option")).toHaveCount(1);
			await expect(
				page.getByRole("option", { name: "São Paulo", exact: true }),
			).toBeVisible();
			const popup = page.locator('[data-slot="combobox-content"]');
			await expect(popup).toBeVisible();
			await expect(page.locator("html")).toHaveClass(
				new RegExp(options.colorScheme),
			);
			assert.ok(
				await popup.evaluate((element) =>
					getComputedStyle(element).getPropertyValue("--popover").trim(),
				),
			);
			await capture(page, `picker-${options.colorScheme}.png`);
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("Enter");
			await expect(trigger).toHaveValue("São Paulo");
			await expect(trigger).toBeFocused();
			await preview.getByRole("button", { name: "Reset", exact: true }).click();
			await expect(trigger).toHaveValue("Weekend");
			assert.ok(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			);
		}, options);
});

test("managed-field preview keeps a readable draft on write loss and removes it on read loss", async () =>
	visit(async (page, url) => {
		await page.goto(`${url}/docs/ui/components/data-bindings/`);
		const preview = page.getByRole("figure", {
			name: "Data bindings example",
			exact: true,
		});
		const notes = preview.getByRole("textbox", { name: "Notes", exact: true });
		await expect(notes).toBeEditable();
		await notes.fill("My protected draft");
		await preview
			.getByRole("button", { name: "Remove save access", exact: true })
			.click();
		await expect(notes).toHaveValue("My protected draft");
		await expect(notes).toBeEditable();
		await expect(
			preview.getByRole("button", { name: "Save notes", exact: true }),
		).toBeDisabled();
		await notes.fill("Still my local draft");
		await preview
			.getByRole("button", { name: "Hide notes", exact: true })
			.click();
		await expect(notes).toHaveValue("");
		await preview.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(notes).toHaveValue("Meet at 10 by the river.");
		await expect(notes).toBeEditable();
	}));

test("feedback preview moves progress into a notification and reset withdraws it", async () =>
	visit(async (page, url) => {
		await page.goto(`${url}/docs/ui/components/activity-toasts/`);
		const preview = page.getByRole("figure", {
			name: "ActivityToasts example",
			exact: true,
		});
		await preview
			.getByRole("button", { name: "Complete the walk", exact: true })
			.click();
		await expect(preview.locator("[data-vem-activity]")).toContainText(
			"Waiting for your next step.",
		);
		await preview
			.getByRole("button", { name: "Show in notifications", exact: true })
			.click();
		const notices = page.getByRole("region", {
			name: "Notifications",
			exact: true,
		});
		await expect(notices).toContainText("Completing the walk");
		await preview
			.getByRole("button", { name: "Lose the response", exact: true })
			.click();
		await expect(notices).toContainText("Response lost after submission");
		await preview.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(notices.locator('[data-slot="toast"]')).toHaveCount(0);
	}));

test("query-status preview distinguishes incomplete, failed, and proven-empty results", async () =>
	visit(async (page, url) => {
		await page.goto(`${url}/docs/ui/components/query-status/`);
		const preview = page.getByRole("figure", {
			name: "QueryStatus example",
			exact: true,
		});
		await expect(preview).toContainText(
			"The available source responses did not establish all requested information",
		);
		await preview
			.getByRole("button", { name: "Complete the list", exact: true })
			.click();
		await expect(preview.locator("[data-vem-query-status]")).toHaveCount(0);
		await preview
			.getByRole("button", { name: "Fail the read", exact: true })
			.click();
		await expect(preview).toContainText("Task service unavailable.");
		await expect(preview).toContainText("Plan a weekend walk");
		await expect(
			preview.getByRole("button", { name: "Retry", exact: true }),
		).toBeVisible();
		await preview
			.getByRole("button", { name: "Return no tasks", exact: true })
			.click();
		await expect(preview).toContainText("No tasks yet.");
		await expect(preview).not.toContainText("Plan a weekend walk");
		await preview.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(preview).toContainText(
			"The available source responses did not establish all requested information",
		);
	}));

test("virtual list guide stays usable on a small touch viewport with reduced motion", async () =>
	visit(
		async (page, url) => {
			await page.goto(`${url}/docs/ui/components/virtual-list/`);
			const preview = page.getByRole("figure", {
				name: "Virtual list example",
				exact: true,
			});
			await expect(preview).toBeVisible();
			await preview.getByRole("switch", { name: "Show notes" }).click();
			const list = preview.getByRole("list", { name: "Tasks" });
			await list.evaluate((element) => {
				element.scrollTop = 5000;
			});
			await expect(preview.getByText("Task 001", { exact: true })).toHaveCount(
				0,
			);
			assert.ok((await preview.getByRole("listitem").count()) < 30);
			assert.equal(
				await page.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						document.documentElement.clientWidth,
				),
				true,
			);
			await capture(page, "virtual-list-mobile-dark.png");
		},
		{
			viewport: { width: 390, height: 844 },
			colorScheme: "dark",
			reducedMotion: "reduce",
			hasTouch: true,
		},
	));
