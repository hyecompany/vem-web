// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
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
async function pageFor(options = {}) {
	const context = await browser.newContext({
		viewport: { width: 1200, height: 1100 },
		...options,
	});
	const page = await context.newPage();
	page.setDefaultTimeout(6000);
	page.on("pageerror", (error) => console.error(error));
	await page.goto(url);
	await page.getByRole("heading", { name: "Controls" }).waitFor();
	return { context, page };
}

test("native form fields reset and refs and render composition retain their DOM behavior", async () => {
	const { context, page } = await pageFor();
	try {
		const link = page.getByRole("button", { name: "Open tasks" });
		assert.equal(await link.getAttribute("href"), "#tasks");
		for (const id of ["hidden-button", "hidden-card", "hidden-textarea"]) {
			assert.equal(
				await page.getByTestId(id).isVisible(),
				false,
				`${id} honors native hidden`,
			);
		}
		assert.equal(
			await page.getByRole("button", { name: "Unavailable" }).isDisabled(),
			true,
		);
		await page.getByRole("button", { name: "Focus email" }).click();
		assert.equal(
			await page
				.locator("#email")
				.evaluate((e) => e === document.activeElement),
			true,
		);
		await page.getByLabel("Email").fill("changed@example.com");
		await page.getByLabel("Notes", { exact: true }).fill("Changed");
		await page.getByRole("switch", { name: "Enabled" }).click();
		assert.equal(
			await page.getByRole("switch", { name: "Enabled" }).isChecked(),
			false,
		);
		await page.getByRole("button", { name: "Reset form" }).click();
		assert.equal(
			await page.getByLabel("Email").inputValue(),
			"hello@example.com",
		);
		assert.equal(
			await page.getByLabel("Notes", { exact: true }).inputValue(),
			"Original notes",
		);
		assert.equal(
			await page.getByRole("switch", { name: "Enabled" }).isChecked(),
			true,
		);
		await page
			.getByRole("button", { name: "Remove item", exact: true })
			.click();
		assert.equal(
			await page
				.getByRole("button", { name: "Remove item", exact: true })
				.count(),
			0,
		);
	} finally {
		await context.close();
	}
});

test("combobox opens demand, filters locally, and commits through keyboard activation", async () => {
	const { context, page } = await pageFor();
	try {
		assert.equal(await page.locator("html").getAttribute("data-mounts"), null);
		const input = page.getByRole("combobox", { name: "Project" });
		await input.click();
		await page.getByRole("option", { name: "Café", exact: true }).waitFor();
		assert.equal(
			await page.locator("html").getAttribute("data-active-demand"),
			"true",
		);
		await input.fill("cafe");
		await page.getByRole("option", { name: "Café", exact: true }).waitFor();
		assert.equal(await page.getByRole("option").count(), 1);
		assert.equal(
			await page.locator('output[aria-label="Selection"]').textContent(),
			"Forest",
		);
		await input.press("ArrowDown");
		await input.press("Enter");
		assert.equal(
			await page.locator('output[aria-label="Selection"]').textContent(),
			"Café",
		);
		assert.equal(
			await page.locator('output[aria-label="Changes"]').textContent(),
			"1",
		);
		assert.equal(
			await page.locator('input[name="project"]').inputValue(),
			"Café",
		);
		await page.waitForFunction(
			() => document.documentElement.dataset.activeDemand === "false",
		);
		await input.click();
		await input.fill("nowhere");
		await page.getByText("No projects found.").waitFor();
		await input.press("Escape");
		assert.equal(
			await input.evaluate((e) => e === document.activeElement),
			true,
		);
		await page
			.getByRole("button", { name: "Clear selection", exact: true })
			.click();
		assert.equal(
			await page.locator('output[aria-label="Selection"]').textContent(),
			"",
		);
	} finally {
		await context.close();
	}
});

test("ordinary CSS branding reaches explicit portal containers without styling host utilities", async () => {
	const { context, page } = await pageFor();
	try {
		const groupBox = await page.locator("#tall-group").boundingBox();
		const fieldBox = await page
			.getByRole("textbox", { name: "Tall field" })
			.boundingBox();
		assert.ok(
			fieldBox.height >= 44,
			"The input fills its enlarged pointer target",
		);
		assert.ok(
			groupBox.height - fieldBox.height <= 2,
			"Only the group border sits outside the input hit area",
		);
		assert.equal(
			await page
				.locator("#branded-button")
				.evaluate((e) => getComputedStyle(e).backgroundColor),
			"rgb(0, 100, 160)",
		);
		assert.equal(
			await page
				.locator("#unscoped")
				.evaluate((e) => getComputedStyle(e).backgroundColor),
			"rgba(0, 0, 0, 0)",
		);
		await page.getByRole("combobox", { name: "Project" }).click();
		await page.getByRole("listbox").waitFor();
		assert.equal(
			await page
				.getByRole("listbox")
				.evaluate((e) => !!e.closest("#portal-scope")),
			true,
		);
		await page.getByRole("combobox", { name: "Project" }).press("Escape");
		await page
			.locator('[data-slot="combobox-content"]')
			.waitFor({ state: "detached" });
		await page.getByRole("button", { name: "Help", exact: true }).hover();
		await page.locator('[data-slot="tooltip-content"]').waitFor();
		assert.equal(
			await page
				.locator('[data-slot="tooltip-content"]')
				.evaluate((e) => !!e.closest("#portal-scope")),
			true,
		);
	} finally {
		await context.close();
	}
});

test("vertical tabs forward orientation and do not expose inactive panels", async () => {
	const { context, page } = await pageFor();
	try {
		assert.equal(
			await page
				.getByRole("tablist", { name: "Views" })
				.getAttribute("aria-orientation"),
			"vertical",
		);
		await page.getByRole("tab", { name: "Overview", exact: true }).focus();
		await page.keyboard.press("ArrowDown");
		assert.equal(
			await page
				.getByRole("tab", { name: "Details", exact: true })
				.getAttribute("aria-selected"),
			"true",
		);
		await page.waitForFunction(
			() => document.querySelectorAll('[role="tabpanel"]').length === 1,
		);
		assert.equal(await page.getByRole("tabpanel").count(), 1);
		assert.equal(
			await page.getByRole("tabpanel").textContent(),
			"Details content",
		);
	} finally {
		await context.close();
	}
});

test("desktop sidebar retains a fixed panel, layout gap, and collapse control", async () => {
	const { context, page } = await pageFor();
	try {
		const sidebar = page.locator('[data-slot="sidebar-container"]');
		assert.equal(
			await page.getByRole("navigation", { name: "Primary" }).isVisible(),
			true,
		);
		assert.equal(await page.getByTestId("host-hidden").isVisible(), false);
		assert.equal(
			await page
				.getByRole("link", { name: "Tasks", exact: true })
				.getAttribute("aria-current"),
			"page",
		);
		assert.equal(
			await sidebar.evaluate((e) => getComputedStyle(e).position),
			"fixed",
		);
		assert.equal(await sidebar.getAttribute("data-custom"), "kept");
		const initial = (
			await page.locator('[data-slot="sidebar-gap"]').boundingBox()
		).width;
		await page.getByRole("button", { name: "Toggle navigation" }).click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-slot="sidebar"]')
					.getAttribute("data-state") === "collapsed",
		);
		await page.waitForFunction(
			(width) =>
				document
					.querySelector('[data-slot="sidebar-gap"]')
					.getBoundingClientRect().width < width,
			initial,
		);
		await page.getByRole("button", { name: "Read sidebar ref" }).click();
		assert.equal(
			await page.locator("html").getAttribute("data-sidebar-ref"),
			"kept",
		);
	} finally {
		await context.close();
	}
});

test("mobile sidebar keeps native attributes, focus restoration, and modal keyboard behavior", async () => {
	const { context, page } = await pageFor({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
	});
	try {
		const trigger = page.getByRole("button", { name: "Toggle navigation" });
		await trigger.tap();
		const dialog = page.getByRole("dialog", { name: "Sidebar", exact: true });
		await dialog.waitFor();
		assert.equal(await dialog.getAttribute("data-custom"), "kept");
		assert.equal(await dialog.getAttribute("title"), "Application navigation");
		assert.match(await dialog.getAttribute("class"), /custom-sidebar/);
		assert.equal(
			await dialog.evaluate((e) => getComputedStyle(e).letterSpacing),
			"0.25px",
		);
		assert.equal(
			await page.getByRole("navigation", { name: "Primary" }).isVisible(),
			true,
		);
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		assert.equal(
			await trigger.evaluate((e) => e === document.activeElement),
			true,
		);
		await trigger.tap();
		await dialog.waitFor();
		await dialog.getByRole("link", { name: "Tasks", exact: true }).tap();
		await dialog.waitFor({ state: "hidden" });
		assert.equal(new URL(page.url()).hash, "#tasks");
	} finally {
		await context.close();
	}
});

test("toast updates one record and retiring it immediately removes action controls", async () => {
	const { context, page } = await pageFor();
	try {
		await page.getByRole("button", { name: "Add notification" }).click();
		await page.getByText("Working", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Update notification" }).click();
		await page.getByText("Finished", { exact: true }).waitFor();
		assert.equal(await page.locator('[data-slot="toast"]').count(), 1);
		await page.getByRole("button", { name: "Close notification" }).click();
		assert.equal(
			await page.getByRole("button", { name: "Undo", exact: true }).count(),
			0,
		);
		await page.locator('[data-slot="toast"]').waitFor({ state: "detached" });
	} finally {
		await context.close();
	}
});

test("composed controls remain accessible in both themes and reduced motion", async () => {
	const { context, page } = await pageFor({ reducedMotion: "reduce" });
	try {
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(value) => (document.documentElement.className = value),
				theme,
			);
			const result = await new AxeBuilder({ page }).analyze();
			assert.deepEqual(
				result.violations.map((v) => ({
					id: v.id,
					nodes: v.nodes.map((n) => n.target),
				})),
				[],
			);
		}
	} finally {
		await context.close();
	}
});

test("sidebar branches preserve parent links and independent expanded disclosures", async () => {
	const { context, page } = await pageFor();
	try {
		const disclosure = page.getByRole("button", { name: "Expand Storage" });
		await disclosure.click();
		await page.getByRole("link", { name: "Volumes", exact: true }).waitFor();
		assert.equal(new URL(page.url()).hash, "");
		await page.getByRole("link", { name: "Storage", exact: true }).click();
		assert.equal(new URL(page.url()).hash, "#storage");
		await page.getByRole("button", { name: "Collapse Storage" }).click();
		assert.equal(
			await page.getByRole("link", { name: "Volumes", exact: true }).count(),
			0,
		);
		await page.getByRole("button", { name: "Toggle navigation" }).click();
		const parent = page.locator(
			'a[data-slot="sidebar-menu-button"][href="#storage"]',
		);
		await parent.focus();
		await parent.press(" ");
		await page.getByRole("menu", { name: "Storage", exact: true }).waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("menu").waitFor({ state: "hidden" });
		await parent.press("Enter");
		assert.equal(new URL(page.url()).hash, "#storage");
		await parent.press("ArrowDown");
		await page.getByRole("menu", { name: "Storage", exact: true }).waitFor();
		assert.equal(
			await page
				.getByRole("menuitem", { name: "Volumes", exact: true })
				.getAttribute("href"),
			"#volumes",
		);
		await page.keyboard.press("Escape");
		await page.getByRole("menu").waitFor({ state: "hidden" });
		const allowed = await parent.evaluate((element) =>
			element.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					ctrlKey: true,
				}),
			),
		);
		assert.equal(
			allowed,
			true,
			"Modified link clicks retain native navigation",
		);
	} finally {
		await context.close();
	}
});

test("compact sidebar branches support touch disclosure without following the parent link", async () => {
	const { context, page } = await pageFor({ hasTouch: true });
	try {
		await page.getByRole("button", { name: "Toggle navigation" }).tap();
		const parent = page.locator(
			'a[data-slot="sidebar-menu-button"][href="#storage"]',
		);
		await parent.tap();
		await page.getByRole("menu", { name: "Storage", exact: true }).waitFor();
		assert.equal(new URL(page.url()).hash, "");
		await page.getByRole("menuitem", { name: "Volumes", exact: true }).tap();
		assert.equal(new URL(page.url()).hash, "#volumes");
		await page.getByRole("menu").waitFor({ state: "hidden" });
		await parent.evaluate((element) => element.click());
		await page.waitForURL("**/#storage");
		assert.equal(
			new URL(page.url()).hash,
			"#storage",
			"Programmatic activation must not inherit the earlier touch gesture",
		);
	} finally {
		await context.close();
	}
});
