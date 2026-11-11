// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { expect } from "@playwright/test";
import { browser } from "../../support/browser.mjs";
import { root, serve } from "../support/site.mjs";

let app, engine;
before(async () => {
	app = await serve();
	engine = await browser();
});
after(async () => {
	await engine?.close();
	await app?.close();
});
async function visit(path, run, options = {}) {
	const context = await engine.newContext(options);
	const page = await context.newPage();
	page.setDefaultTimeout(8000);
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	try {
		await page.goto(`${app.url}${path}`);
		await run(page, context);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
}
test("filtering, overview, and reopening details reuse actual knowledge", async () =>
	visit("/docs/data/understand/acquisition", async (page) => {
		const lab = page.getByRole("region", { name: "Filter without fetching" });
		await expect(lab).toContainText("1 service read");
		await lab.getByRole("button", { name: "To do", exact: true }).click();
		await expect(lab).not.toContainText("Pack a picnic");
		await expect(lab).toContainText("1 service read");
		await lab.getByRole("button", { name: "Overview", exact: true }).click();
		await expect(
			lab.getByRole("complementary", { name: "Plan overview" }),
		).toContainText("1 of 2");
		await expect(lab).toContainText("1 service read");
		await lab
			.getByRole("button", { name: "Plan a weekend walk", exact: true })
			.click();
		await expect(lab).toContainText("Meet at 10 by the river.");
		await expect(lab).toContainText("2 service reads");
		await lab.getByRole("button", { name: "Back to tasks" }).click();
		await lab
			.getByRole("button", { name: "Plan a weekend walk", exact: true })
			.click();
		await expect(lab).toContainText("2 service reads");
		await lab.getByRole("button", { name: "Start over" }).click();
		await expect(lab).toContainText("1 service read");
		await expect(lab).toContainText("Pack a picnic");
		await lab
			.getByRole("button", { name: "Pack a picnic", exact: true })
			.click();
		await expect(lab).toContainText("Bring sandwiches and a flask of tea.");
		await expect(lab).toContainText("2 service reads");
		await lab.getByRole("button", { name: "Back to tasks" }).click();
		await lab
			.getByRole("button", { name: "Plan a weekend walk", exact: true })
			.click();
		await expect(lab).toContainText("Meet at 10 by the river.");
		await expect(lab).toContainText("3 service reads");
		await lab.getByRole("button", { name: "Back to tasks" }).click();
		await lab
			.getByRole("button", { name: "Pack a picnic", exact: true })
			.click();
		await expect(lab).toContainText("Bring sandwiches and a flask of tea.");
		await expect(lab).toContainText("3 service reads");
	}));
test("the task app distinguishes missing display data, unknown matches, failures and emptiness", async () =>
	visit("/docs/data/build/partial-results", async (page) => {
		const lab = page.getByRole("region", {
			name: "When part of the list is missing",
		});
		await expect(lab).toContainText("Title unavailable");
		await lab.getByText("How Vem sees this", { exact: true }).click();
		await expect(lab.locator("dl")).toContainText("Matching rows1");
		await lab.getByRole("combobox").selectOption("filter");
		await expect(
			lab.getByRole("region", { name: "Match not confirmed", exact: true }),
		).toContainText("Plan a weekend walk");
		await expect(lab.getByRole("listitem")).toHaveCount(1);
		await lab.getByText("How Vem sees this", { exact: true }).click();
		await expect(lab.locator("dl")).toContainText("Confirmed matches0");
		await lab.getByRole("combobox").selectOption("failed");
		await expect(lab).toContainText("Plan a weekend walk");
		await lab.getByRole("button", { name: "Try again", exact: true }).click();
		await expect(lab).toContainText("The retry succeeded");
		await lab.getByRole("combobox").selectOption("empty");
		await expect(lab).toContainText("Nothing to do here.");
		await lab.getByRole("button", { name: "Start over" }).click();
		await expect(lab).toContainText("Title unavailable");
	}));
test("completing a task teaches previews, progress and all four outcomes", async () =>
	visit("/docs/data/build/actions", async (page) => {
		const lab = page.getByRole("region", {
			name: "A checkmark before confirmation",
		});
		for (const [reply, outcome] of [
			["Confirm completion", "succeeded"],
			["Save only the note", "partial"],
			["Reject the change", "failed"],
			["Lose the response", "unknown"],
		]) {
			await lab
				.getByRole("button", {
					name: "Complete Plan a weekend walk",
					exact: true,
				})
				.click();
			await expect(
				lab.getByRole("region", { name: "Weekend plans" }),
			).toContainText("Unconfirmed");
			await expect(
				lab.getByRole("complementary", { name: "Saved progress" }),
			).toContainText("0 done");
			await lab.getByText("Try another reply", { exact: true }).click();
			await lab.getByRole("button", { name: "Send a progress update" }).click();
			await expect(
				lab.getByRole("progressbar", { name: "Task progress" }),
			).toHaveAttribute("value", "1");
			await lab.getByRole("button", { name: reply, exact: true }).click();
			await lab.getByText("How Vem sees this", { exact: true }).click();
			await expect(lab.locator(".lesson-evidence")).toContainText(
				`Action outcome: ${outcome}`,
			);
			await expect(lab.locator(".lesson-evidence")).toContainText(
				`Service-confirmed status: ${outcome === "succeeded" ? "Done" : "To do"}`,
			);
			await expect(
				lab.getByRole("complementary", { name: "Saved progress" }),
			).toContainText(outcome === "succeeded" ? "1 done" : "0 done");
			if (outcome === "unknown")
				await expect(
					lab.getByRole("region", { name: "Weekend plans" }),
				).toContainText("Unconfirmed");
			else
				await expect(
					lab.getByRole("region", { name: "Weekend plans" }),
				).not.toContainText("Unconfirmed");
			if (outcome === "partial")
				await expect(lab).toContainText("Completion note was saved.");
			await lab.getByRole("button", { name: "Start over" }).click();
		}
	}));
test("editing preserves dirty input through conflict and selectively forgets private values", async () =>
	visit("/docs/data/build/editors", async (page) => {
		const lab = page.getByRole("region", { name: "Keep your own draft" });
		const draft = lab.getByRole("textbox", { name: "Notes", exact: true });
		await expect(draft).toHaveValue("Meet at 10 by the river.");
		await draft.fill("My meeting time");
		await lab
			.getByRole("textbox", { name: "Title", exact: true })
			.fill("Keep this public draft");
		await lab
			.getByText("Try a teammate or permission change", { exact: true })
			.click();
		await lab.getByRole("button", { name: "Teammate saves a note" }).click();
		await expect(draft).toHaveValue("My meeting time");
		await expect(lab).toContainText("Meet at 11 at the north gate.");
		await lab
			.getByRole("button", { name: "Save changes", exact: true })
			.click();
		await expect(lab.getByRole("alert")).toContainText(
			"Your draft is still here",
		);
		await lab.getByRole("button", { name: "Make read-only" }).click();
		await expect(draft).toHaveValue("My meeting time");
		await expect(
			lab.getByRole("button", { name: "Save changes", exact: true }),
		).toBeDisabled();
		await lab.getByRole("button", { name: "Hide private notes" }).click();
		await expect(draft).toHaveCount(0);
		await expect(
			lab.getByRole("textbox", { name: "Title", exact: true }),
		).toHaveValue("Keep this public draft");
		await expect(lab).not.toContainText("My meeting time");
		await lab.getByRole("button", { name: "Start over" }).click();
		await expect(draft).toHaveValue("Meet at 10 by the river.");
	}));
test("permission switches preserve independent access and reject a held old reply", async () =>
	visit("/docs/data/understand/access", async (page) => {
		const lab = page.getByRole("region", {
			name: "Who can still read the notes?",
		});
		await expect(lab.locator(".private-note")).toContainText(
			"Meet at 10 by the river.",
		);
		await lab
			.getByText("What if an old reply arrives later?", { exact: true })
			.click();
		await lab
			.getByRole("button", { name: "Hold a reply", exact: true })
			.click();
		await expect(lab).toContainText("Reply held.");
		await lab.getByRole("switch", { name: "Team access" }).uncheck();
		await expect(lab.locator(".private-note")).toContainText(
			"Meet at 10 by the river.",
		);
		await lab.getByRole("switch", { name: "Direct invitation" }).uncheck();
		await expect(lab.locator(".private-note")).toContainText(
			"no longer have access",
		);
		await lab.getByRole("switch", { name: "Team access" }).check();
		await lab.getByRole("button", { name: "Deliver held reply" }).click();
		await expect(lab.locator(".private-note")).toContainText(
			"Waiting for updated notes.",
		);
		await expect(lab).not.toContainText("Old delayed notes");
		await lab.getByRole("button", { name: "Send a new update" }).click();
		await expect(lab.locator(".private-note")).toContainText(
			"meet at the south gate",
		);
		await lab.getByRole("button", { name: "Start over" }).click();
		await expect(lab.locator(".private-note")).toContainText(
			"Meet at 10 by the river.",
		);
	}));
test("reopening an unfinished task investigates once without sending it again", async () =>
	visit("/docs/data/understand/recovery", async (page) => {
		const lab = page.getByRole("region", {
			name: "Return to an unfinished action",
		});
		await lab
			.getByRole("button", {
				name: "Complete Plan a weekend walk",
				exact: true,
			})
			.click();
		await lab.getByRole("button", { name: "Close and reopen app" }).click();
		await expect(lab).toContainText(
			"Sent 1 time · checked 1 time · still unconfirmed",
		);
		await expect(lab).toContainText("Plan a weekend walk");
		await lab.getByRole("button", { name: "Start over" }).click();
		await expect(
			lab.getByRole("button", {
				name: "Complete Plan a weekend walk",
				exact: true,
			}),
		).toBeEnabled();
	}));
test("static reading, mobile layout, reduced motion, and keyboard controls remain usable", async () => {
	await visit(
		"/docs/data/build/editors",
		async (page) => {
			await expect(
				page.getByRole("heading", {
					name: "Build a protected editor",
					exact: true,
				}),
			).toBeVisible();
			await expect(page.locator("pre").first()).toContainText("useEdit");
			await expect(
				page.getByRole("figure", {
					name: "An editor keeps its concurrency baseline",
				}),
			).toBeVisible();
		},
		{ javaScriptEnabled: false },
	);
	for (const width of [390, 640, 1280])
		await visit(
			"/docs/data/understand/acquisition",
			async (page) => {
				assert.ok(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
					"no page-wide horizontal overflow",
				);
				const toggle = page.getByRole("button", { name: "To do", exact: true });
				await toggle.focus();
				await page.keyboard.press("Space");
				await expect(toggle).toHaveAttribute("aria-pressed", "true");
				assert.equal(
					await toggle.evaluate((el) => getComputedStyle(el).outlineStyle),
					"solid",
				);
				await mkdir(resolve(root, "packages/docs/.generated/screenshots"), {
					recursive: true,
				});
				await page.screenshot({
					path: resolve(
						root,
						`packages/docs/.generated/screenshots/acquisition-${width}.png`,
					),
					fullPage: true,
				});
			},
			{ viewport: { width, height: 900 }, reducedMotion: "reduce" },
		);
});
test("search accepts API names and ordinary questions with keyboard navigation", async () =>
	visit("/docs/data/start/quickstart", async (page) => {
		await expect(
			page.getByRole("button", { name: "To do", exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: /Search/ })
			.first()
			.click();
		const dialog = page.getByRole("dialog");
		for (const [question, answer] of [
			["useQuery", "useQuery"],
			["nothing fetched", "Nothing fetched or no event socket"],
			["partial rows", "Partial rows"],
			["save conflict", "Save conflict"],
			["another tab", "Another tab"],
		]) {
			await dialog.getByRole("combobox").fill(question);
			await expect(
				dialog.getByRole("option").filter({ hasText: answer }).first(),
			).toBeVisible();
		}
		await dialog.getByRole("combobox").fill("nothing fetched");
		await expect(dialog.getByRole("option").first()).toContainText(
			"Troubleshooting",
		);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/troubleshooting/);
		await expect(dialog).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: "Troubleshooting" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Search/ }).first(),
		).not.toBeFocused();
	}));
