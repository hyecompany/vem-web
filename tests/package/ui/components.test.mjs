// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import { browser } from "../../support/browser.mjs";

const fixture = process.env.VEM_UI_CONSUMER;
test("packed components hydrate, resize, and reveal in a consumer without Tailwind", {
	skip: !fixture,
}, async () => {
	const { serve } = await import(
		pathToFileURL(join(fixture, "serve.mjs")).href
	);
	const app = await serve();
	const engine = await browser();
	const context = await engine.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	try {
		const response = await fetch(app.url);
		const html = await response.text();
		assert.ok(
			html.includes("Quarterly 👩🏽‍🚀 café research report 🇺🇳 final.pdf"),
		);
		const staticPage = await engine.newPage({ javaScriptEnabled: false });
		try {
			await staticPage.goto(app.url);
			await expect(
				staticPage.getByRole("button", { name: "Save task", exact: true }),
			).toHaveCSS("background-color", "rgb(95, 55, 164)");
			await expect(staticPage.locator("html")).not.toHaveAttribute(
				"data-hydrated",
			);
		} finally {
			await staticPage.close();
		}
		await page.goto(app.url);
		await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
		const save = page.getByRole("button", { name: "Save task", exact: true });
		await expect(save).toHaveCSS("background-color", "rgb(95, 55, 164)");
		await expect(save).toHaveCSS("border-bottom-width", "3px");
		const hostControl = page.getByRole("button", {
			name: "Host styled control",
			exact: true,
		});
		await expect(hostControl).toHaveClass(/(?:^| )border(?: |$)/);
		await expect(hostControl).toHaveCSS("border-top-width", "3px");
		await save.click();
		await expect(page.locator("output")).toHaveText("Task saved");
		await page.evaluate(() => document.documentElement.classList.add("dark"));
		const board = page.getByRole("combobox", { name: "Board", exact: true });
		await board.click();
		const list = page.locator('[data-slot="combobox-content"]');
		await expect(list).toHaveCSS("background-color", "rgb(36, 36, 36)");
		await page.getByRole("option", { name: "Work", exact: true }).click();
		await expect(board).toHaveValue("Work");

		const parent = page.getByTestId("parent");
		const overflow = parent.locator(".vem-overflow");
		const rest = overflow.locator(".vem-overflow-rest");
		await expect(parent).toHaveAccessibleName(
			"Quarterly 👩🏽‍🚀 café research report 🇺🇳 final.pdf",
		);
		await expect(overflow).toHaveAttribute("data-vem-overflow", "true");
		await expect(
			page.getByRole("status", { name: "Saving changes" }),
		).toHaveCSS("width", "16px");
		await expect(
			page.getByRole("button", { name: "Connect", exact: true }).locator("svg"),
		).toHaveCSS("width", "32px");
		const initial = await rest.textContent();
		assert.ok(initial.includes("…"));
		const graphemes = (text) =>
			Array.from(
				new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
					text,
				),
				({ segment }) => segment,
			);
		const source = new Set(
			graphemes("Quarterly 👩🏽‍🚀 café research report 🇺🇳 final.pdf"),
		);
		assert.ok(
			graphemes(initial).every(
				(character) => character === "…" || source.has(character),
			),
		);
		await page
			.getByRole("button", { name: "Open scaled popup", exact: true })
			.click();
		const popup = page.getByTestId("scaled-popup");
		const popupLabel = popup.locator(".vem-overflow-rest");
		await expect(popup.locator(".vem-overflow")).toHaveAttribute(
			"data-vem-overflow",
			"true",
		);
		await expect
			.poll(() =>
				popupLabel.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			)
			.toBe(true);
		const shortened = await popupLabel.textContent();
		assert.ok(shortened.endsWith(".pdf"));
		await page
			.getByRole("button", { name: "Finish opening", exact: true })
			.click();
		await expect(popup).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
		await expect(popupLabel).toHaveText(shortened);
		assert.ok(
			await popupLabel.evaluate(
				(element) => element.scrollWidth <= element.clientWidth,
			),
		);
		const motionViewport = overflow.locator(".vem-overflow-viewport");
		await expect(motionViewport).toHaveCSS("mask-image", /linear-gradient/);
		await expect(parent).toHaveCSS("mask-image", "none");
		await expect(overflow).toHaveCSS("mask-image", "none");
		await expect(rest).toHaveCSS("mask-image", "none");
		await parent.focus();
		await expect(overflow.locator(".vem-overflow-track")).toHaveCSS(
			"animation-name",
			"vem-overflow-scroll",
		);
		await page.getByRole("button", { name: "Resize", exact: true }).click();
		await expect(overflow).not.toHaveAttribute("data-vem-overflow");
		await expect(motionViewport).toHaveCount(0);
		await expect(rest).toHaveText(
			"Quarterly 👩🏽‍🚀 café research report 🇺🇳 final.pdf",
		);
		await page.getByRole("button", { name: "Resize", exact: true }).click();
		await expect(overflow).toHaveAttribute("data-vem-overflow", "true");
		await page.getByRole("button", { name: "Change letter spacing" }).click();
		await expect(rest).not.toHaveText(initial);
		await page.getByRole("button", { name: "Highlight item" }).click();
		await expect(overflow.locator(".vem-overflow-track")).toHaveCSS(
			"animation-name",
			"vem-overflow-scroll",
		);
		await page.getByTestId("rtl").hover();
		await expect(page.getByTestId("rtl").locator(".vem-overflow")).toHaveCSS(
			"direction",
			"rtl",
		);
		const travel = await page
			.getByTestId("rtl")
			.locator(".vem-overflow-track")
			.evaluate((element) =>
				getComputedStyle(element).getPropertyValue("--vem-overflow-travel"),
			);
		assert.ok(travel.includes("50% + 12px"));
		await expect(
			page.getByTestId("rtl").locator(".vem-overflow-viewport"),
		).toHaveCSS("mask-image", /linear-gradient/);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expect(overflow.locator(".vem-overflow-track")).toHaveCSS(
			"animation-name",
			"none",
		);
		await expect(rest).toHaveCSS("opacity", "1");
		await expect(rest).toHaveCSS("mask-image", "none");
		await expect(overflow.locator(".vem-overflow-track")).toHaveCSS(
			"visibility",
			"hidden",
		);
		await expect(page.locator(".vem-spinner rect").first()).toHaveCSS(
			"animation-name",
			"none",
		);
		await expect(page.getByTestId("full-name")).toBeVisible();
		if (process.env.VEM_UI_SCREENSHOT)
			await page.screenshot({
				path: process.env.VEM_UI_SCREENSHOT,
				fullPage: true,
			});
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
		await engine.close();
		await app.close();
	}
});
