// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { browser } from "../support/browser.mjs";
import { serve } from "./support/site.mjs";

test("landing and focused guides pass automated accessibility checks in light and dark modes", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		for (const colorScheme of ["light", "dark"]) {
			const context = await engine.newContext({
				colorScheme,
				reducedMotion: "reduce",
			});
			const page = await context.newPage();
			for (const path of [
				"/",
				"/docs/data/start/quickstart",
				"/docs/data/understand/acquisition",
				"/docs/data/build/editors",
				"/docs/data/build/actions",
				"/docs/data/understand/access",
				"/docs/data/connect/resources",
				"/docs/data/connect/access",
				"/docs/data/connect/planning",
				"/docs/data/connect/browser-host",
				"/docs/data/connect/commands-edits",
				"/docs/data/connect/operations",
				"/docs/ui",
				"/docs/ui/overflow-text",
				"/docs/ui/spinner",
				"/docs/task-board",
				"/docs/ui/components/button",
				"/docs/ui/components/combobox",
				"/docs/ui/components/sidebar",
				"/docs/ui/components/data-bindings",
				"/docs/ui/components/activity-toasts",
			]) {
				await page.goto(app.url + path);
				const foreground =
					colorScheme === "dark" ? "rgb(235, 235, 235)" : "rgb(10, 10, 10)";
				const background =
					colorScheme === "dark" ? "rgb(18, 18, 18)" : "rgb(245, 245, 245)";
				await expect(page.locator("body")).toHaveCSS("color", foreground);
				await expect(page.locator("body")).toHaveCSS(
					"background-color",
					background,
				);
				await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
					"color",
					foreground,
				);
				if (path.includes("quickstart") || path.includes("acquisition"))
					await expect(
						page.getByRole("button", { name: "To do", exact: true }),
					).toBeVisible();
				if (path.includes("editors"))
					await expect(
						page.getByRole("textbox", { name: "Notes", exact: true }),
					).toBeVisible();
				const result = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
					.analyze();
				assert.deepEqual(
					result.violations.map((v) => ({
						id: v.id,
						nodes: v.nodes.map((n) => n.target),
					})),
					[],
					`${path} ${colorScheme}`,
				);
			}
			await context.close();
		}
	} finally {
		await engine.close();
		await app.close();
	}
});

test("touch editors have readable text and comfortable targets without horizontal overflow", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		for (const width of [320, 390]) {
			const context = await engine.newContext({
				viewport: { width, height: 844 },
				hasTouch: true,
				reducedMotion: "reduce",
			});
			try {
				const page = await context.newPage();
				await page.goto(`${app.url}/docs/data/build/editors`);
				const notes = page.getByRole("textbox", { name: "Notes", exact: true });
				await expect(notes).toHaveValue("Meet at 10 by the river.");
				await expect(notes).toHaveCSS("font-size", "16px");
				await expect(
					page.getByRole("textbox", { name: "Title", exact: true }),
				).toHaveCSS("font-size", "16px");
				await page
					.getByText("Try a teammate or permission change", { exact: true })
					.click();
				for (const control of await page
					.locator(
						".lesson button:visible, .lesson summary:visible, .lesson input:visible",
					)
					.all()) {
					const bounds = await control.boundingBox();
					assert.ok(bounds && bounds.height >= 44, await control.textContent());
				}
				assert.ok(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				);
				await notes.fill("Meet at noon");
				await page
					.getByRole("button", { name: "Save changes", exact: true })
					.click();
				await expect(page.getByRole("status")).toContainText("Saved");
			} finally {
				await context.close();
			}
		}
	} finally {
		await engine.close();
		await app.close();
	}
});

test("reduced-motion navigation keeps keyboard focus and uses fades instead of movement", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		const page = await engine.newPage({
			viewport: { width: 390, height: 844 },
			reducedMotion: "reduce",
		});
		await page.goto(`${app.url}/docs/data/start/overview`);
		const trigger = page
			.getByRole("button", { name: "Open Sidebar", exact: true })
			.filter({ visible: true })
			.first();
		await trigger.focus();
		await page.keyboard.press("Enter");
		const panel = page.locator("#nd-sidebar-mobile");
		await expect(panel).toBeVisible();
		await expect(panel).toHaveCSS("animation-name", "fd-fade-in");
		await panel.getByRole("link", { name: "Task board", exact: true }).focus();
		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();
		await expect(trigger).toBeFocused();
		const search = page.getByRole("button", {
			name: "Open Search",
			exact: true,
		});
		await search.focus();
		await page.keyboard.press("Enter");
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveCSS("animation-name", "fd-fade-in");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(search).toBeFocused();
	} finally {
		await engine.close();
		await app.close();
	}
});

test("mobile sidebar restores focus without relying on animation completion", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		const page = await engine.newPage({
			viewport: { width: 390, height: 844 },
			reducedMotion: "reduce",
		});
		await page.goto(`${app.url}/docs/data/start/overview`);
		await page.addStyleTag({
			content: "#nd-sidebar-mobile { animation: none !important; }",
		});
		const trigger = page
			.getByRole("button", { name: "Open Sidebar", exact: true })
			.filter({ visible: true })
			.first();
		const panel = page.locator("#nd-sidebar-mobile");
		for (const dismissal of ["Escape", "button"]) {
			await trigger.focus();
			await page.keyboard.press("Enter");
			await expect(panel).toBeVisible();
			await panel
				.getByRole("link", { name: "Task board", exact: true })
				.focus();
			if (dismissal === "Escape") await page.keyboard.press("Escape");
			else
				await panel
					.getByRole("button", { name: "Close Sidebar", exact: true })
					.click();
			await expect(panel).toBeHidden();
			await expect(trigger).toBeFocused();
		}
		await trigger.focus();
		await page.keyboard.press("Enter");
		await expect(panel).toBeVisible();
		await panel.getByRole("link", { name: "Task board", exact: true }).focus();
		const search = page.getByRole("button", {
			name: "Open Search",
			exact: true,
		});
		await search.focus();
		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();
		await expect(search).toBeFocused();

		await trigger.focus();
		await page.keyboard.press("Enter");
		await panel.getByRole("link", { name: "Task board", exact: true }).click();
		await expect(page).toHaveURL(`${app.url}/docs/task-board/`);
		await expect(panel).toBeHidden();
		await expect(trigger).not.toBeFocused();
	} finally {
		await engine.close();
		await app.close();
	}
});

test("stored document theme styles package controls before hydration and after interaction", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		for (const theme of ["dark", "light"]) {
			const context = await engine.newContext({
				colorScheme: theme === "dark" ? "light" : "dark",
			});
			await context.addInitScript(
				(value) => localStorage.setItem("theme", value),
				theme,
			);
			const page = await context.newPage();
			let resume;
			const scripts = new Promise((resolve) => {
				resume = resolve;
			});
			await page.route("**/_next/static/**/*.js", async (route) => {
				await scripts;
				await route.continue();
			});
			try {
				await page.goto(`${app.url}/docs/ui/components/button/`, {
					waitUntil: "commit",
				});
				const button = page.getByRole("button", {
					name: "Save task",
					exact: true,
				});
				await expect(button).toBeVisible();
				await expect(page.locator("html")).toHaveClass(new RegExp(theme));
				const expected =
					theme === "dark" ? "rgb(250, 250, 250)" : "rgb(23, 23, 23)";
				await expect(button).toHaveCSS("background-color", expected);
				resume();
				await page.waitForLoadState();
				await button.click();
				await expect(page.getByRole("status")).toHaveText("Task saved");
				await page.mouse.move(0, 0);
				await expect(button).toHaveCSS("background-color", expected);
			} finally {
				resume();
				await context.close();
			}
		}
	} finally {
		await engine.close();
		await app.close();
	}
});
