// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { browser } from "../../support/browser.mjs";
import { root, serve } from "../support/site.mjs";

const name = "Research · São Paulo · shared development";
const screenshots = resolve(root, "packages/docs/.generated/screenshots");
async function screenshot(page, file) {
	await mkdir(screenshots, { recursive: true });
	await page.screenshot({ path: resolve(screenshots, file), fullPage: true });
}
async function changeWidth(page, reducedMotion = false) {
	const preview = page.getByRole("figure", { name: "A long project name" });
	const trigger = preview.getByRole("button", { name, exact: true });
	const label = trigger.locator(".vem-overflow");
	await expect(label).toHaveAttribute("data-vem-overflow", "true");
	await expect(trigger).toHaveAccessibleName(name);
	await expect(preview.locator("p")).toHaveText(name);
	await trigger.focus();
	await expect(trigger).toBeFocused();
	await expect(label.locator(".vem-overflow-track")).toHaveCSS(
		"animation-name",
		reducedMotion ? "none" : "vem-overflow-scroll",
	);
	const initial = await trigger.boundingBox();
	await page.keyboard.press("Tab");
	await expect(
		preview.getByRole("button", { name: "Widen control" }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(
		preview.getByRole("button", { name: "Narrow control" }),
	).toBeVisible();
	await expect
		.poll(async () => (await trigger.boundingBox()).width)
		.toBeGreaterThan(initial.width);
	await preview.getByRole("button", { name: "Narrow control" }).click();
	await expect
		.poll(async () => (await trigger.boundingBox()).width)
		.toBe(initial.width);
	await expect(label).toHaveAttribute("data-vem-overflow", "true");
}
async function checkSpinnerSizes(page, reducedMotion = false, capture) {
	const preview = page.getByRole("figure", { name: "Loading feedback" });
	await expect(
		preview.getByRole("button", { name: "Medium", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	const time = new Date();
	await page.clock.install({ time });
	await page.clock.pauseAt(new Date(time.getTime() + 60_000));
	for (const [size, width] of [
		["Small", 16],
		["Medium", 24],
		["Large", 32],
	]) {
		const choice = preview.getByRole("button", { name: size, exact: true });
		await choice.focus();
		await page.keyboard.press("Enter");
		await expect(choice).toHaveAttribute("aria-pressed", "true");
		await preview
			.getByRole("button", { name: "Load tasks", exact: true })
			.click();
		const loading = preview.getByRole("button", {
			name: "Loading tasks…",
			exact: true,
		});
		await expect(loading).toBeDisabled();
		const spinner = loading.locator(".vem-spinner");
		await expect(spinner).toHaveAttribute("aria-hidden", "true");
		await expect(spinner.locator("svg")).toHaveCSS("width", `${width}px`);
		await expect(spinner.locator("rect").first()).toHaveCSS(
			"animation-name",
			reducedMotion ? "none" : "vem-spinner-fade",
		);
		if (size === "Large" && capture) await screenshot(page, capture);
		await page.clock.runFor(1200);
		await expect(
			preview.getByRole("button", { name: "Load tasks", exact: true }),
		).toBeEnabled();
		await expect(preview.locator(".vem-spinner")).toHaveCount(0);
	}
}

test("UI previews hydrate and work with keyboard controls in both themes", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		const errors = [];
		for (const colorScheme of ["light", "dark"]) {
			const context = await engine.newContext({ colorScheme });
			try {
				const page = await context.newPage();
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error")
						errors.push(`${message.text()} (${message.location().url})`);
				});
				await page.goto(`${app.url}/docs/ui/overflow-text/`);
				await changeWidth(page);
				await screenshot(page, `ui-overflow-${colorScheme}.png`);
				await page.goto(`${app.url}/docs/ui/spinner/`);
				await checkSpinnerSizes(page, false, `ui-spinner-${colorScheme}.png`);
			} finally {
				await context.close();
			}
		}
		assert.deepEqual(errors, []);
	} finally {
		await engine.close();
		await app.close();
	}
});

test("mobile previews retain complete names and static indicators with reduced motion", async () => {
	const app = await serve();
	const engine = await browser();
	try {
		for (const { width, colorScheme } of [320, 390].flatMap((width) =>
			["light", "dark"].map((colorScheme) => ({ width, colorScheme })),
		)) {
			const context = await engine.newContext({
				viewport: { width, height: 844 },
				colorScheme,
				hasTouch: true,
				reducedMotion: "reduce",
			});
			try {
				const page = await context.newPage();
				await page.goto(`${app.url}/docs/ui/overflow-text/`);
				await changeWidth(page, true);
				await expect(
					page
						.getByRole("figure", { name: "A long project name" })
						.locator("p"),
				).toBeVisible();
				assert.ok(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				);
				await screenshot(
					page,
					`ui-overflow-mobile-${width}-${colorScheme}.png`,
				);
				await page.goto(`${app.url}/docs/ui/spinner/`);
				await checkSpinnerSizes(
					page,
					true,
					`ui-spinner-mobile-${width}-${colorScheme}.png`,
				);
				assert.ok(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				);
			} finally {
				await context.close();
			}
		}
	} finally {
		await engine.close();
		await app.close();
	}
});

test("UI guides explain the components and expose full labels without JavaScript", async () => {
	const app = await serve();
	const engine = await browser();
	const context = await engine.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${app.url}/docs/ui/`);
		await expect(
			page.getByRole("heading", { name: "Vem UI", exact: true }),
		).toBeVisible();
		await expect(page.locator("main")).toContainText(
			"@hyecompany/vem-ui/styles.css",
		);
		await page.goto(`${app.url}/docs/ui/overflow-text/`);
		const overflow = page.getByRole("figure", { name: "A long project name" });
		await expect(overflow.locator("p")).toHaveText(name);
		await expect(overflow.locator("figcaption")).toContainText(
			"reading it never requires animation",
		);
		await expect(page.locator("main")).toContainText("function FileName");
		await expect(
			page.getByRole("link", { name: "All props", exact: true }),
		).toHaveAttribute("href", /TypeAlias\.OverflowTextProps/);
		await page.goto(`${app.url}/docs/ui/spinner/`);
		await expect(
			page
				.getByRole("figure", { name: "Loading feedback" })
				.locator("figcaption"),
		).toContainText("its spinner is decorative");
		await expect(page.locator("main")).toContainText(
			"function SavingIndicator",
		);
		await expect(page.locator("main")).toContainText("aria-labelledby");
	} finally {
		await context.close();
		await engine.close();
		await app.close();
	}
});
