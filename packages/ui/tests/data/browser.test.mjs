// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { createServer } from "vite";
import { browser } from "../../../../tests/support/browser.mjs";

async function fixture(
	t,
	{ protectedAction = false, inspector, search = false } = {},
) {
	const server = await createServer({
		configFile: false,
		root: fileURLToPath(new URL("./fixture", import.meta.url)),
		logLevel: "error",
		oxc: { jsx: { runtime: "automatic" } },
		server: { host: "127.0.0.1", port: 0 },
		optimizeDeps: {
			force: true,
			include: [
				"react",
				"react-dom/client",
				"@hyecompany/vem-data",
				"@hyecompany/vem-data/react",
				"@hyecompany/vem-data/testing",
				"@hyecompany/vem-data/devtools",
				"@hyecompany/vem-ui",
				"@hyecompany/vem-ui/data",
				"@hyecompany/vem-ui/devtools",
			],
		},
	});
	await server.listen();
	t.after(() => server.close());
	const app = await browser();
	t.after(() => app.close());
	const page = await app.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		server.resolvedUrls.local[0] +
			(search
				? "search.html"
				: inspector
					? `inspector.html${inspector === "live" ? "?live" : ""}`
					: protectedAction
						? "?protected"
						: ""),
	);
	await expect(
		page.getByRole("button", {
			name: search
				? "Enable search"
				: inspector
					? "Show inspector"
					: protectedAction
						? "Save protected task"
						: "Complete task",
			exact: true,
		}),
	).toBeEnabled();
	t.after(() => assert.deepEqual(errors, []));
	return page;
}

test("command activation observes one action, navigation hands feedback off, and uncertain completion is never retried", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t);
	await page
		.getByRole("button", { name: "Complete task", exact: true })
		.evaluate((button) => {
			button.click();
			button.click();
		});
	await expect.poll(() => page.evaluate(() => window.fixture.calls())).toBe(1);
	await expect(
		page.getByRole("button", { name: "Complete task", exact: true }),
	).toBeDisabled();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Leave section" }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(1);
	await page.getByRole("button", { name: "Return to section" }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Leave section" }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(1);
	await page.locator("[data-slot=toast]:not([data-ending-style])").hover();
	await page.getByRole("button", { name: "Close toast" }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(0);
	await page.evaluate(() =>
		window.fixture.settle({
			kind: "unknown",
			message: "The server outcome could not be established.",
		}),
	);
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toContainText("The server outcome could not be established.");
	await expect(
		page.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => window.fixture.calls())).toBe(1);
});

test("managed input remains editable on write loss and selectively forgets unreadable data", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t);
	const notes = page.getByLabel("Notes", { exact: true });
	await expect(notes).toHaveValue("Protected notes");
	await notes.fill("Unsaved private draft");
	await page.evaluate(() => window.fixture.write("denied"));
	await expect(notes).toBeEnabled();
	await expect(page.getByRole("button", { name: "Save notes" })).toBeDisabled();
	await page.evaluate(() => window.fixture.access("unknown"));
	await expect(notes).toBeDisabled();
	await expect(notes).toHaveValue("");
	await page.getByLabel("Title", { exact: true }).fill("Public draft");
	await page.evaluate(() => window.fixture.access("allowed"));
	await expect(notes).toHaveValue("Unsaved private draft");
	await page.evaluate(() => window.fixture.access("denied"));
	await expect(notes).toHaveValue("");
	await page.evaluate(() => window.fixture.access("allowed"));
	await expect(notes).toHaveValue("");
	await expect(notes).toBeDisabled();
	await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
		"Public draft",
	);
});

test("protected toast content withdraws through its live action subscription without acknowledging server work", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t, { protectedAction: true });
	await page.getByRole("button", { name: "Save protected task" }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toContainText("Confidential destination");
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toContainText("Protected progress");
	await page.evaluate(async () => {
		window.fixture.withdraw();
		await new Promise(requestAnimationFrame);
	});
	await expect(page.locator("body")).not.toContainText(
		"Confidential destination",
	);
	await expect(page.locator("body")).not.toContainText("Protected progress");
	assert.equal(await page.evaluate(() => window.fixture.cancellations()), 0);
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(0);
	await page.evaluate(() =>
		window.fixture.settlePrivate({
			kind: "succeeded",
			value: "Confidential result",
		}),
	);
	await expect(page.locator("body")).not.toContainText("Confidential result");
});

test("native feedback retry starts one explicit attempt and command target changes retain no old busy or failure state", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t);
	await page.evaluate(() => window.fixture.failRun(true));
	await page
		.getByRole("button", { name: "Complete task", exact: true })
		.click();
	await expect(page.locator("body")).toContainText(
		"The command could not be started",
	);
	await expect(page.locator("body")).not.toContainText(
		"Protected synchronous exception details",
	);
	await page.getByRole("button", { name: "Switch command target" }).click();
	await expect(
		page.getByRole("button", { name: "Complete other task" }),
	).toBeEnabled();
	await expect(page.locator("body")).not.toContainText(
		"The command could not be started",
	);
	await page.evaluate(() => window.fixture.failRun(false));
	await page.getByRole("button", { name: "Complete other task" }).click();
	await page.getByRole("button", { name: "Switch command target" }).click();
	await expect(
		page.getByRole("button", { name: "Complete task", exact: true }),
	).toBeEnabled();
	await page.evaluate(() =>
		window.fixture.settle({
			kind: "failed",
			submitted: false,
			error: { message: "Source refused before submission" },
		}),
	);
	const retry = page.getByRole("button", { name: "Retry", exact: true });
	await expect(retry).toBeEnabled();
	await retry.evaluate((button) => {
		button.click();
		button.click();
	});
	await expect.poll(() => page.evaluate(() => window.fixture.calls())).toBe(2);
	await page.getByRole("button", { name: "Leave section" }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])").first(),
	).toBeVisible();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style]) output output"),
	).toHaveCount(0);
});

test("toast cancellation uses the native observer control without the starting handle", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t, { protectedAction: true });
	await page.getByRole("button", { name: "Save protected task" }).click();
	await page
		.getByRole("button", { name: "Cancel", exact: true })
		.evaluate((button) => {
			button.click();
			button.click();
		});
	await expect
		.poll(() => page.evaluate(() => window.fixture.cancellations()))
		.toBe(1);
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toContainText("Cancellation confirmed.");
	await expect(
		page.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
});

test("an accepted toast retry acknowledges only the prior failure and rejected admission keeps it visible", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t);
	await page
		.getByRole("button", { name: "Complete task", exact: true })
		.click();
	await page.getByRole("button", { name: "Leave section" }).click();
	await page.evaluate(() =>
		window.fixture.settle({
			kind: "failed",
			submitted: false,
			error: { message: "Refused before submission" },
		}),
	);
	const retry = page.getByRole("button", { name: "Retry", exact: true });
	await expect(retry).toBeEnabled();
	await retry.click();
	await expect.poll(() => page.evaluate(() => window.fixture.calls())).toBe(2);
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toHaveCount(1);
	await page.evaluate(() => window.fixture.rejectNextControl());
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toContainText("A retry could not be started");
	await expect(
		page.locator("[data-slot=toast]:not([data-ending-style])"),
	).toContainText("Refused before submission");
	assert.equal(await page.evaluate(() => window.fixture.calls()), 2);
});

test("live inspector observes consumed queries without acquiring or retaining consumer demand", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t, { inspector: "live" });
	const tasks = page.getByRole("region", { name: "Task list" });
	await expect(tasks).toContainText("Pack a picnic");
	assert.equal(await page.evaluate(() => window.inspectorFixture.reads()), 1);
	await page.getByRole("button", { name: "Show inspector" }).click();
	const tools = page.getByRole("region", { name: "Data tools" });
	const query = tools.locator('[data-query-resource="tasks"]');
	await expect(tools).toContainText("Live inspection");
	await expect(query).toHaveAttribute("data-query-consumers", "1");
	await expect(tools.getByLabel("Acquisition state")).toHaveCount(0);
	const explanation = query.getByText("How reads are chosen", { exact: true });
	const scope = query.getByText(/This inspector shows consumer demand/);
	await expect(scope).not.toBeVisible();
	await explanation.focus();
	await explanation.press("Enter");
	await expect(scope).toBeVisible();
	await explanation.press("Enter");
	await expect(scope).not.toBeVisible();
	assert.equal(await page.evaluate(() => window.inspectorFixture.reads()), 1);
	await page.getByRole("button", { name: "Hide inspector" }).click();
	await page.getByRole("button", { name: "Receive task update" }).click();
	await expect(tasks).toContainText("Plan a weekend walk");
	await page.getByRole("button", { name: "Show inspector" }).click();
	await query.getByText("Result details", { exact: true }).click();
	await expect(query.locator("pre")).toContainText("Plan a weekend walk");
	await page.getByRole("button", { name: "Hide tasks" }).click();
	await expect(query).toHaveAttribute("data-query-consumers", "0");
	await expect(query).toContainText("No active consumer");
	await expect(query.locator("pre")).not.toContainText("Plan a weekend walk");
	await page.getByRole("button", { name: "Show tasks" }).click();
	await expect(tasks).toContainText("Plan a weekend walk");
	await expect(query).toHaveAttribute("data-query-consumers", "1");
	assert.equal(await page.evaluate(() => window.inspectorFixture.reads()), 1);
});

test("inspector scenario controls update partial and failed consumer states and restore available values", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t, { inspector: "scenario" });
	const tasks = page.getByRole("region", { name: "Task list" });
	await expect(tasks).toContainText("Bring sandwiches");
	await page.getByRole("button", { name: "Show inspector" }).click();
	const tools = page.getByRole("region", { name: "Data tools" });
	const query = tools.locator('[data-query-resource="tasks"]');
	await expect(tools).toContainText("Isolated task scenarios");
	await query.getByLabel("Acquisition state").selectOption("partial");
	await query.getByRole("checkbox", { name: "notes", exact: true }).check();
	await query.getByRole("button", { name: "Apply query scenario" }).click();
	await expect(tasks).toContainText("Pack a picnic");
	await expect(tasks).toContainText("Notes unavailable");
	await expect(query).toContainText("Incomplete membership");
	await expect(tasks.getByLabel("Query state")).toHaveText("content");
	await query.getByLabel("Acquisition state").selectOption("failed");
	await query
		.getByLabel("Explanation", { exact: true })
		.fill("Task service unavailable");
	await query.getByRole("button", { name: "Apply query scenario" }).click();
	await expect(tasks).toContainText("Task service unavailable");
	await expect(tasks).toContainText("Pack a picnic");
	await query.getByLabel("Acquisition state").selectOption("ready");
	await query.getByRole("button", { name: "Apply query scenario" }).click();
	await expect(tasks).toContainText("Bring sandwiches");
	await expect(tasks.getByLabel("Query state")).toHaveText("content");
	await expect(tasks).not.toContainText("Task service unavailable");
	await expect(tasks).not.toContainText(
		"Some information is not available yet.",
	);
	await page.getByRole("button", { name: "Hide inspector" }).click();
	await expect(tools).toHaveCount(0);
	await expect(tasks).toContainText("Bring sandwiches");
	await page.getByRole("button", { name: "Show inspector" }).click();
	await expect(query).toHaveAttribute("data-query-consumers", "1");
});

test("search delegates acquisition, reuses known matches, and preserves text until an explicit reset", {
	timeout: 60_000,
}, async (t) => {
	const page = await fixture(t, { search: true });
	const input = page.getByRole("textbox", { name: "Search tasks" });
	const rows = page
		.getByRole("list", { name: "Search results" })
		.getByRole("listitem");
	const reads = () => page.evaluate(() => window.searchFixture.reads());
	await input.fill("PICNIC");
	await expect(rows).toHaveCount(0);
	assert.equal(await reads(), 0);
	await page.getByRole("button", { name: "Enable search" }).click();
	await expect(rows).toHaveCount(0);
	assert.equal(await reads(), 0);
	await page.getByRole("button", { name: "Allow acquisition" }).click();
	await expect.poll(reads).toBe(1);
	await expect(page.getByLabel("Fetching")).toHaveText("true");
	await page.evaluate(() => window.searchFixture.finish());
	await expect(rows).toHaveText(["Pack a picnic"]);
	await expect(page.getByLabel("Fetching")).toHaveText("false");

	await input.fill("WALK");
	await expect(rows).toHaveText(["Plan a weekend walk"]);
	assert.equal(await reads(), 1);
	await page.getByRole("button", { name: "Disable search" }).click();
	await expect(rows).toHaveCount(0);
	await expect(input).toHaveValue("WALK");
	await page.getByRole("button", { name: "Clear search" }).click();
	await expect(input).toHaveValue("");
	await expect(rows).toHaveCount(0);
	await page.getByRole("button", { name: "Enable search" }).click();
	await expect(rows).toHaveText(["Pack a picnic", "Plan a weekend walk"]);
	assert.equal(await reads(), 1);

	await page.getByRole("button", { name: "Observe only" }).click();
	await page.getByRole("button", { name: "Receive update" }).click();
	await expect(rows).toHaveText(["Pack lunch", "Plan a weekend walk"]);
	assert.equal(await reads(), 1);
});
