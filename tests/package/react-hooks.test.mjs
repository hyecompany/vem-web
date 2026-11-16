// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import { build, preview } from "vite";
import { browser } from "../support/browser.mjs";

test("conditional React queries release demand, reuse knowledge on reopen, and withdraw disabled data", async (t) => {
	const parent = process.env.VEM_STARTER_DIRECTORY
		? resolve(process.env.VEM_STARTER_DIRECTORY, "../..")
		: resolve(import.meta.dirname, "../..");
	const directory = await mkdtemp(join(parent, ".react-hooks-test-"));
	let server;
	let engine;
	t.after(async () => {
		await engine?.close();
		await new Promise((resolve) =>
			server ? server.httpServer.close(resolve) : resolve(),
		);
		assert.equal(dirname(directory), parent);
		assert.ok(basename(directory).startsWith(".react-hooks-test-"));
		await rm(directory, { recursive: true, force: true, maxRetries: 3 });
	});
	await cp(
		fileURLToPath(new URL("./fixtures/react-hooks", import.meta.url)),
		directory,
		{ recursive: true },
	);
	await writeFile(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				jsx: "react-jsx",
				lib: ["ES2023", "DOM", "DOM.Iterable"],
				strict: true,
				noEmit: true,
				skipLibCheck: true,
			},
			include: ["*.tsx"],
		}),
	);
	const consumerRequire = createRequire(join(directory, "package.json"));
	await promisify(execFile)(
		process.execPath,
		[
			consumerRequire.resolve("typescript/bin/tsc"),
			"-p",
			join(directory, "tsconfig.json"),
		],
		{ windowsHide: true },
	);
	await build({
		root: directory,
		configFile: false,
		logLevel: "warn",
		esbuild: { jsx: "automatic" },
	});
	server = await preview({
		root: directory,
		configFile: false,
		logLevel: "warn",
		preview: { host: "127.0.0.1", port: 0 },
	});
	engine = await browser();
	const page = await engine.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
	const stats = () => page.evaluate(() => window.fixture.stats());
	await expect(page.getByTestId("first")).toBeEmpty();
	assert.deepEqual(await stats(), { reads: 0, subscribers: 0 });
	await page.getByRole("button", { name: "Retry first", exact: true }).click();
	assert.deepEqual(await stats(), { reads: 0, subscribers: 0 });
	await page.getByRole("button", { name: "Toggle first", exact: true }).click();
	await expect(page.getByTestId("first")).toHaveText("Protected task");
	assert.deepEqual(await stats(), { reads: 1, subscribers: 1 });
	await page.getByRole("button", { name: "Toggle first", exact: true }).click();
	await expect(page.getByTestId("first")).toBeEmpty();
	assert.deepEqual(await stats(), { reads: 1, subscribers: 0 });
	await page.evaluate(() => {
		window.fixture.frames = [];
	});
	await page.getByRole("button", { name: "Toggle first", exact: true }).click();
	await expect(page.getByTestId("first")).toHaveText("Protected task");
	const frames = await page.evaluate(() =>
		window.fixture.frames.filter(
			(frame) => frame.id === "first" && frame.enabled,
		),
	);
	assert.ok(frames.length > 0);
	assert.ok(
		frames.every(
			(frame) => frame.rows === 1 && frame.complete && !frame.fetching,
		),
		"warm reactivation must not commit a loading snapshot",
	);
	await page
		.getByRole("button", { name: "Toggle second", exact: true })
		.click();
	await expect(page.getByTestId("second")).toHaveText("Protected task");
	assert.deepEqual(await stats(), { reads: 1, subscribers: 2 });
	await page.getByRole("button", { name: "Toggle first", exact: true }).click();
	await expect(page.getByTestId("first")).toBeEmpty();
	assert.deepEqual(await stats(), { reads: 1, subscribers: 1 });
	await page
		.getByRole("button", { name: "Toggle second", exact: true })
		.click();
	assert.deepEqual(await stats(), { reads: 1, subscribers: 0 });
	await page.evaluate(() => window.fixture.revoke());
	await page.getByRole("button", { name: "Toggle first", exact: true }).click();
	await expect(page.getByTestId("first")).toBeEmpty();
	assert.deepEqual(await stats(), { reads: 1, subscribers: 1 });
	await page.getByRole("button", { name: "Toggle first", exact: true }).click();
	await page.evaluate(() => window.fixture.grant());
	await page
		.getByRole("button", { name: "Toggle passive", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Toggle observer", exact: true })
		.click();
	await expect(page.getByTestId("passive")).toBeEmpty();
	await expect(page.getByTestId("passive")).toHaveAttribute(
		"data-settled",
		"true",
	);
	await expect(page.getByTestId("read-status")).toHaveText("idle");
	assert.deepEqual(await stats(), { reads: 1, subscribers: 1 });
	await page.evaluate(() => window.fixture.pause());
	await page
		.getByRole("button", { name: "Toggle second", exact: true })
		.click();
	await expect(page.getByTestId("read-status")).toHaveText("pending");
	await page
		.getByRole("button", { name: "Toggle observer", exact: true })
		.click();
	await expect(page.getByTestId("read-status")).toHaveText("idle");
	await page
		.getByRole("button", { name: "Toggle observer", exact: true })
		.click();
	await expect(page.getByTestId("read-status")).toHaveText("pending");
	await page.evaluate(() => window.fixture.resume());
	await expect(page.getByTestId("passive")).toHaveText("Protected task");
	await expect(page.getByTestId("read-status")).toHaveText("idle");
	await page
		.getByRole("button", { name: "Toggle second", exact: true })
		.click();
	await expect(page.getByTestId("passive")).toHaveText("Protected task");
	assert.deepEqual(await stats(), { reads: 2, subscribers: 1 });
	await page.evaluate(() => window.fixture.revoke());
	await expect(page.getByTestId("passive")).toBeEmpty();
	await page.evaluate(() => window.fixture.grant());
	assert.deepEqual(await stats(), { reads: 2, subscribers: 1 });
	await page
		.getByRole("button", { name: "Toggle acquisition", exact: true })
		.click();
	await expect(page.getByTestId("passive")).toHaveText("Protected task");
	assert.deepEqual(await stats(), { reads: 3, subscribers: 1 });
	await page
		.getByRole("button", { name: "Toggle acquisition", exact: true })
		.click();
	await expect(page.getByTestId("passive")).toHaveText("Protected task");
	assert.deepEqual(await stats(), { reads: 3, subscribers: 1 });
	assert.deepEqual(errors, []);
});
