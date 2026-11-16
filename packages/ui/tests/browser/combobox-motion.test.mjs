// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { createServer } from "vite";
import { browser as launchBrowser } from "../../../../tests/support/browser.mjs";

let server, browser, url;
before(async () => {
	server = await createServer({
		configFile: false,
		optimizeDeps: { force: true },
		root: fileURLToPath(new URL("./fixture", import.meta.url)),
		server: { host: "127.0.0.1", port: 0 },
	});
	await server.listen();
	url = server.resolvedUrls.local[0];
	browser = await launchBrowser();
});
after(async () => {
	await browser?.close();
	await server?.close();
});
async function motionPage(options) {
	const page = await browser.newPage(options);
	await page.addInitScript(() => {
		window.motionErrors = [];
		window.addEventListener("error", (event) =>
			window.motionErrors.push(event.message),
		);
	});
	return page;
}

for (const manual of [false, true]) {
	test(`combobox ${manual ? "rendered" : "collection"} choices animate without retaining removed options or changing selection`, async () => {
		const page = await motionPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto(`${url}motion.html${manual ? "?manual" : ""}`);
			const input = page.getByRole("combobox", { name: "Project" });
			await expect(page.getByRole("option")).toHaveCount(3);
			await input.focus();
			await page.evaluate(() => {
				window.motionFrames = [];
				const animate = Element.prototype.animate;
				Element.prototype.animate = function (frames, options) {
					window.motionFrames.push({
						slot: this.getAttribute("data-slot"),
						text: this.textContent,
						frames,
					});
					return animate.call(this, frames, options);
				};
				window.updateChoices(["Arrival", "Alpha", "Bravo", "Charlie"]);
			});
			await expect(page.getByRole("option")).toHaveCount(4);
			await expect(input).toBeFocused();
			await expect
				.poll(() =>
					page.evaluate(() =>
						window.motionFrames.some(
							(call) =>
								call.text.includes("Arrival") && call.frames[0].opacity === 0,
						),
					),
				)
				.toBe(true);
			await expect
				.poll(() =>
					page.evaluate(() =>
						window.motionFrames.some(
							(call) =>
								call.slot === "combobox-content" &&
								call.frames[0].height !== call.frames[1].height,
						),
					),
				)
				.toBe(true);
			await expect
				.poll(() =>
					page.evaluate(() =>
						window.motionFrames.some(
							(call) =>
								call.slot === "combobox-item" &&
								call.text.includes("Bravo") &&
								call.frames[0].translate !== "0 0",
						),
					),
				)
				.toBe(true);
			await page.evaluate(() => window.updateChoices(["Bravo", "Charlie"]));
			await expect(
				page.getByRole("option", { name: "Arrival", exact: true }),
			).toHaveCount(0);
			assert.equal(await page.getByText("Arrival", { exact: true }).count(), 0);
			await input.fill("Ch");
			await expect(page.getByRole("option")).toHaveCount(1);
			await input.fill("B");
			await expect(
				page.getByRole("option", { name: "Bravo", exact: true }),
			).toBeVisible();
			await expect(input).toBeFocused();
			await expect(page.locator('output[aria-label="Selection"]')).toHaveText(
				"none",
			);
			await input.press("ArrowDown");
			await input.press("Enter");
			await expect(page.locator('output[aria-label="Selection"]')).toHaveText(
				"Bravo",
			);
			await expect(page.getByRole("listbox")).toHaveCount(0);
			assert.deepEqual(errors, []);
		} finally {
			assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
			await page.close();
		}
	});
}

test("reduced motion and absent animation support leave current choices immediately usable", async () => {
	for (const reduced of [true, false]) {
		const page = await motionPage({
			reducedMotion: reduced ? "reduce" : "no-preference",
		});
		if (!reduced)
			await page.addInitScript(() => {
				Element.prototype.animate = undefined;
			});
		try {
			await page.goto(`${url}motion.html?manual`);
			const input = page.getByRole("combobox", { name: "Project" });
			await expect(page.getByRole("option")).toHaveCount(3);
			await input.fill("Br");
			await expect(page.getByRole("option")).toHaveCount(1);
			assert.equal(
				await page
					.getByRole("listbox")
					.evaluate((list) => list.getAnimations({ subtree: true }).length),
				0,
			);
			assert.equal(
				await page.evaluate(() => window.readListRef()),
				"preserved",
			);
		} finally {
			assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
			await page.close();
		}
	}
});

test("popup size eases status insertion and removal without retaining the removed message", async () => {
	const page = await motionPage();
	try {
		await page.goto(`${url}motion.html?manual`);
		await expect(page.getByRole("option")).toHaveCount(3);
		const popup = page.locator('[data-slot="combobox-content"]');
		await popup.evaluate(async (node) =>
			Promise.allSettled(
				node.getAnimations().map((animation) => animation.finished),
			),
		);
		const original = (await popup.boundingBox()).height;
		await page.evaluate(() => window.setStatus("Could not load projects"));
		await expect(
			page.getByRole("status", { name: "Read status" }),
		).toBeVisible();
		await expect
			.poll(() =>
				popup.evaluate((node) =>
					node
						.getAnimations()
						.some((animation) =>
							animation.effect
								?.getKeyframes()
								.some((frame) => frame.height !== undefined),
						),
				),
			)
			.toBe(true);
		await popup.evaluate(async (node) =>
			Promise.allSettled(
				node.getAnimations().map((animation) => animation.finished),
			),
		);
		const expanded = (await popup.boundingBox()).height;
		assert.ok(expanded > original + 20);
		await page.evaluate(() => window.setStatus(""));
		await expect(page.getByRole("status", { name: "Read status" })).toHaveCount(
			0,
		);
		await expect
			.poll(() =>
				popup.evaluate((node) =>
					node.getAnimations().some((animation) => {
						const frames = animation.effect?.getKeyframes() ?? [];
						return (
							Number.parseFloat(frames[0]?.height) >
							Number.parseFloat(frames.at(-1)?.height)
						);
					}),
				),
			)
			.toBe(true);
		await popup.evaluate((node) => {
			const animation = node
				.getAnimations()
				.find(
					(candidate) =>
						candidate.effect?.getKeyframes()[0]?.height !== undefined,
				);
			animation.pause();
			animation.currentTime = animation.effect.getTiming().duration / 2;
		});
		const midway = (await popup.boundingBox()).height;
		assert.ok(midway > original && midway < expanded);
		await page.evaluate(() => window.setStatus("Another failure"));
		await expect(page.getByRole("status", { name: "Read status" })).toHaveText(
			"Another failure",
		);
		await expect
			.poll(() =>
				popup.evaluate(
					(node) =>
						node
							.getAnimations()
							.filter(
								(animation) =>
									animation.playState === "running" &&
									animation.effect?.getKeyframes()[0]?.height !== undefined,
							).length,
				),
			)
			.toBe(1);
		const restart = await popup.evaluate((node) => {
			const animation = node
				.getAnimations()
				.find(
					(candidate) =>
						candidate.effect?.getKeyframes()[0]?.height !== undefined,
				);
			return Number.parseFloat(animation.effect.getKeyframes()[0].height);
		});
		assert.ok(
			Math.abs(restart - midway) < 1,
			"new content retargets from the visible frame instead of completing an obsolete size",
		);
		await popup.evaluate(async (node) => {
			const animations = node.getAnimations();
			for (const animation of animations) animation.finish();
			await Promise.allSettled(
				animations.map((animation) => animation.finished),
			);
		});
		await page.evaluate(() => window.setStatus(""));
		await expect
			.poll(async () => (await popup.boundingBox()).height)
			.toBe(original);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.evaluate(() => window.setStatus("Another failure"));
		await expect(
			page.getByRole("status", { name: "Read status" }),
		).toBeVisible();
		assert.equal(
			await popup.evaluate((node) => node.getAnimations().length),
			0,
		);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});
