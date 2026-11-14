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

test("virtual combobox renders bounded rows, exposes only visible demand, and reaches unmounted choices by keyboard", async () => {
	const page = await motionPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(`${url}virtual.html`);
		const input = page.getByRole("combobox", { name: "Project" });
		const list = page.getByRole("listbox");
		await expect(
			page.getByRole("option", { name: "Project 0000", exact: true }),
		).toBeVisible();
		assert.ok((await page.getByRole("option").count()) < 30);
		await expect
			.poll(() => page.evaluate(() => window.activeDescriptions.size))
			.toBeGreaterThan(0);
		const visible = await page
			.locator('[role="option"][data-visible="true"]')
			.count();
		assert.equal(
			await page.evaluate(() => window.activeDescriptions.size),
			visible,
		);
		assert.ok(visible <= (await page.getByRole("option").count()));
		await input.focus();
		await input.press("ArrowUp");
		await expect(
			page.getByRole("option", { name: "Project 0999", exact: true }),
		).toBeInViewport();
		await expect(
			page.getByRole("option", { name: "Project 0999", exact: true }),
		).toHaveAttribute("aria-posinset", "1000");
		await expect(
			page.getByRole("option", { name: "Project 0999", exact: true }),
		).toHaveAttribute("aria-setsize", "1000");
		await input.press("Enter");
		await expect(page.getByRole("status", { name: "Selection" })).toHaveText(
			"Project 0999",
		);
		await input.click();
		await expect(
			page.getByRole("option", { name: "Project 0999", exact: true }),
		).toBeInViewport();
		await input.fill("Project 005");
		await expect(
			page.getByRole("option", { name: "Project 0050", exact: true }),
		).toBeVisible();
		await expect
			.poll(() => list.evaluate((node) => node.scrollTop))
			.toBeLessThan(10);
		await input.press("ArrowDown");
		await input.press("Enter");
		await expect(page.getByRole("status", { name: "Selection" })).toHaveText(
			"Project 0050",
		);
		await page.keyboard.press("Escape");
		await page.evaluate(() =>
			window.setProjects(
				Array.from({ length: 1001 }, (_, index) => ({
					id: String(index),
					name: `Project ${String(index).padStart(4, "0")}`,
				})),
			),
		);
		await input.click();
		await input.fill("Project 1000");
		await expect(
			page.getByRole("option", { name: "Project 1000", exact: true }),
		).toBeInViewport();
		await expect
			.poll(() => page.evaluate(() => window.activeDescriptions.has("1000")))
			.toBe(true);
		assert.deepEqual(errors, []);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

test("visible row growth is measured without overlapping options and scrolling does not animate arrivals", async () => {
	const page = await motionPage();
	try {
		await page.goto(`${url}virtual.html`);
		const first = page.locator('[data-project="0"]');
		await expect(first).toBeVisible();
		const before = await first.boundingBox();
		await page.evaluate(() =>
			window.setDescription("A newly available description"),
		);
		await expect
			.poll(async () => (await first.boundingBox()).height)
			.toBeGreaterThan(before.height + 10);
		await expect
			.poll(async () => {
				const rows = await page
					.locator("[data-vem-virtual-row]")
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							top: node.offsetTop,
							height: node.offsetHeight,
						})),
					);
				return rows.every(
					(row, index) =>
						index === 0 ||
						row.top >= rows[index - 1].top + rows[index - 1].height - 1,
				);
			})
			.toBe(true);
		const list = page.getByRole("listbox");
		await list.evaluate((node) => {
			node.scrollTop = 1500;
		});
		await expect(page.locator('[data-project="0"]')).toHaveCount(0);
		await expect(
			page.locator(".vem-virtual-row-content[data-entering]"),
		).toHaveCount(0);
		await expect
			.poll(() => page.evaluate(() => window.activeDescriptions.size))
			.toBeGreaterThan(0);
		const ids = await page
			.locator('[role="option"][data-visible="true"]')
			.evaluateAll((nodes) => nodes.map((node) => node.dataset.project).sort());
		assert.deepEqual(
			await page.evaluate(() => [...window.activeDescriptions].sort()),
			ids,
		);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

for (const reducedMotion of ["no-preference", "reduce"]) {
	test(`virtual collection changes animate surviving rows without retaining removed content (${reducedMotion})`, async () => {
		const page = await motionPage({ reducedMotion });
		try {
			await page.goto(`${url}virtual.html`);
			await expect(page.getByRole("option").first()).toBeVisible();
			await page.evaluate(() =>
				window.setProjects([
					{ id: "a", name: "Alpha" },
					{ id: "b", name: "Bravo" },
				]),
			);
			await expect(page.getByRole("option")).toHaveCount(2);
			await page.evaluate(async () => {
				await Promise.all(
					document
						.getAnimations()
						.map((animation) => animation.finished.catch(() => {})),
				);
			});
			await page.evaluate(() => {
				window.reflowFrames = [];
				const animate = Element.prototype.animate;
				Element.prototype.animate = function (frames, options) {
					window.reflowFrames.push({ text: this.textContent, frames });
					return animate.call(this, frames, options);
				};
				window.setProjects([
					{ id: "new", name: "Arrival" },
					{ id: "a", name: "Alpha" },
					{ id: "b", name: "Bravo" },
				]);
			});
			await expect(page.getByRole("option")).toHaveCount(3);
			if (reducedMotion === "no-preference") {
				await expect
					.poll(() =>
						page.evaluate(() =>
							window.reflowFrames.some(
								(call) =>
									call.text.includes("Bravo") &&
									call.frames[0].translate !== "0 0",
							),
						),
					)
					.toBe(true);
			} else
				assert.deepEqual(await page.evaluate(() => window.reflowFrames), []);
			await page.evaluate(() =>
				window.setProjects([{ id: "b", name: "Bravo" }]),
			);
			await expect(
				page.getByRole("option", { name: "Alpha", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("option", { name: "Arrival", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("option", { name: "Bravo", exact: true }),
			).toHaveAttribute("aria-posinset", "1");
		} finally {
			assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
			await page.close();
		}
	});
}

test("initial selected identity is revealed before mounting detail demand for unrelated first rows", async () => {
	const page = await motionPage();
	try {
		await page.goto(`${url}virtual.html?selected`);
		await expect(
			page.getByRole("option", { name: "Project 0999", exact: true }),
		).toBeInViewport();
		assert.equal(
			await page.evaluate(() => window.seenDescriptions.has("0")),
			false,
		);
		await expect
			.poll(() => page.evaluate(() => window.activeDescriptions.has("999")))
			.toBe(true);
		const batches = await page.evaluate(() => window.descriptionBatches);
		assert.equal(
			batches.length,
			1,
			"the initial viewport publishes demand together",
		);
		assert.ok(
			batches[0].length > 1,
			"the selected bottom row does not acquire ahead of its visible neighbors",
		);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

test("a growing short viewport activates a newly intersecting row even when the virtual range is unchanged", async () => {
	const page = await motionPage();
	try {
		await page.goto(`${url}virtual.html`);
		await expect(page.getByRole("option").first()).toBeVisible();
		await page.evaluate(() => window.setProjects([{ id: "a", name: "Alpha" }]));
		await expect
			.poll(() => page.evaluate(() => window.activeDescriptions.has("a")))
			.toBe(true);
		await page.evaluate(() =>
			window.setProjects([
				{ id: "a", name: "Alpha" },
				{ id: "b", name: "Bravo" },
			]),
		);
		await expect(
			page.getByRole("option", { name: "Bravo", exact: true }),
		).toBeInViewport();
		await expect
			.poll(() => page.evaluate(() => window.activeDescriptions.has("b")))
			.toBe(true);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

test("filtering a visible distant identity does not animate it from its old offscreen coordinate", async () => {
	const page = await motionPage();
	try {
		await page.goto(`${url}virtual.html?selected`);
		const input = page.getByRole("combobox", { name: "Project" });
		await expect(
			page.getByRole("option", { name: "Project 0999", exact: true }),
		).toBeInViewport();
		await page.evaluate(() => {
			window.reflowChecks = new Promise((resolve) => {
				const frames = [];
				function sample() {
					const option = document.querySelector('[data-project="999"]');
					const list = document.querySelector('[role="listbox"]');
					const row = option?.getBoundingClientRect(),
						viewport = list?.getBoundingClientRect();
					frames.push(
						!!row &&
							!!viewport &&
							row.bottom > viewport.top &&
							row.top < viewport.bottom,
					);
					if (frames.length < 18) requestAnimationFrame(sample);
					else resolve(frames);
				}
				requestAnimationFrame(sample);
			});
		});
		await input.fill("Project 0999");
		const frames = await page.evaluate(() => window.reflowChecks);
		assert.ok(
			frames.every(Boolean),
			"the retained option stays visible during the entire reflow",
		);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

test("filtering a virtual collection animates the popup's actual clamped height", async () => {
	const page = await motionPage();
	try {
		await page.goto(`${url}virtual.html`);
		const input = page.getByRole("combobox", { name: "Project" });
		const popup = page.locator('[data-slot="combobox-content"]');
		await expect(
			page.getByRole("option", { name: "Project 0000", exact: true }),
		).toBeVisible();
		await popup.evaluate(async (node) =>
			Promise.allSettled(
				node.getAnimations().map((animation) => animation.finished),
			),
		);
		const expanded = (await popup.boundingBox()).height;
		await input.fill("Project 0000");
		await expect(page.getByRole("option")).toHaveCount(1);
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
		const bounds = await popup.evaluate((node) => {
			const animation = node
				.getAnimations()
				.find(
					(candidate) =>
						candidate.effect?.getKeyframes()[0]?.height !== undefined,
				);
			const frames = animation.effect.getKeyframes();
			animation.pause();
			animation.currentTime = animation.effect.getTiming().duration / 2;
			return {
				from: Number.parseFloat(frames[0].height),
				to: Number.parseFloat(frames.at(-1).height),
			};
		});
		assert.ok(
			bounds.from <= expanded + 1,
			"animation starts from the visible viewport, not thousands of virtual pixels",
		);
		const midway = (await popup.boundingBox()).height;
		assert.ok(midway > bounds.to && midway < bounds.from);
		await popup.evaluate(async (node) => {
			const animations = node.getAnimations();
			for (const animation of animations) animation.finish();
			await Promise.allSettled(
				animations.map((animation) => animation.finished),
			);
		});
		await expect(
			page.getByRole("option", { name: "Project 0000", exact: true }),
		).toBeInViewport();
		await input.press("ArrowDown");
		await input.press("Enter");
		await expect(page.getByRole("status", { name: "Selection" })).toHaveText(
			"Project 0000",
		);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

test("virtual viewport and popup status resize without observer feedback loops", async () => {
	const page = await motionPage({ viewport: { width: 1000, height: 740 } });
	try {
		await page.goto(`${url}virtual.html`);
		const input = page.getByRole("combobox", { name: "Project" });
		await expect(page.getByRole("option").first()).toBeVisible();
		await page.evaluate(() =>
			window.setProjects([
				{ id: "a", name: "Alpha" },
				{ id: "b", name: "Bravo" },
			]),
		);
		await expect(page.getByRole("option")).toHaveCount(2);
		for (let index = 0; index < 12; index++) {
			await page.evaluate(
				(show) =>
					window.setVirtualStatus(show ? "Some details unavailable" : ""),
				index % 2 === 0,
			);
			await page.setViewportSize({
				width: index % 2 ? 1000 : 390,
				height: index % 2 ? 740 : 600,
			});
			await input.press("Escape");
			await input.click();
		}
		await page.evaluate(async () =>
			Promise.allSettled(
				document.getAnimations().map((animation) => animation.finished),
			),
		);
		await expect(page.getByRole("option")).toHaveCount(2);
	} finally {
		assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
		await page.close();
	}
});

for (const reducedMotion of ["no-preference", "reduce"]) {
	test(`growing a short collection publishes its measured viewport together (${reducedMotion})`, async () => {
		const page = await motionPage({ reducedMotion });
		try {
			await page.goto(`${url}virtual.html`);
			await expect(page.getByRole("option").first()).toBeVisible();
			await page.evaluate(() =>
				window.setProjects([{ id: "a", name: "Alpha" }]),
			);
			await expect
				.poll(() => page.evaluate(() => [...window.activeDescriptions]))
				.toEqual(["a"]);
			await page.evaluate(async () =>
				Promise.allSettled(
					document.getAnimations().map((animation) => animation.finished),
				),
			);
			await page.evaluate(() => {
				window.descriptionBatches = [];
				window.setProjects(
					Array.from({ length: 5 }, (_, index) => ({
						id: String(index),
						name: `Visible ${index}`,
					})),
				);
			});
			await expect
				.poll(() => page.evaluate(() => window.activeDescriptions.size))
				.toBe(5);
			assert.deepEqual(await page.evaluate(() => window.descriptionBatches), [
				["0", "1", "2", "3", "4"],
			]);
			await page.evaluate(() => {
				window.descriptionBatches = [];
				window.seenDescriptions.clear();
				window.setProjects(
					Array.from({ length: 500 }, (_, index) => ({
						id: `large-${index}`,
						name: `Large ${index}`,
					})),
				);
			});
			await expect
				.poll(() =>
					page.evaluate(() =>
						[...window.activeDescriptions].some((id) =>
							id.startsWith("large-"),
						),
					),
				)
				.toBe(true);
			assert.ok(
				(await page.evaluate(() => window.seenDescriptions.size)) < 12,
				"growing the collection never activates offscreen rows",
			);
		} finally {
			assert.deepEqual(await page.evaluate(() => window.motionErrors), []);
			await page.close();
		}
	});
}
