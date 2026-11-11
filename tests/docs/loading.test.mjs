// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { browser } from "../support/browser.mjs";
import { root, serve } from "./support/site.mjs";

test("prose pages skip experiments and focused guides load only their experiment", async () => {
	const manifest = JSON.parse(
		await readFile(
			resolve(root, "packages/docs/.next/react-loadable-manifest.json"),
			"utf8",
		),
	);
	const entries = Object.entries(manifest).map(([name, entry]) => [
		name.replaceAll("\\", "/"),
		entry.files,
	]);
	const experimentFiles = new Set(
		entries
			.filter(
				([name]) =>
					name.startsWith("components/InteractiveExamples.tsx") ||
					name.startsWith("components/Lab.tsx"),
			)
			.flatMap(([, files]) => files),
	);
	assert.ok(
		experimentFiles.size > 0,
		"interactive examples have separate chunks",
	);
	const filesFor = (name) => {
		const entry = entries.find(([key]) => key.endsWith(name));
		assert.ok(entry, name);
		return entry[1];
	};
	const app = await serve();
	const engine = await browser();
	try {
		for (const [path, lesson] of [
			["/docs/data/start/overview", undefined],
			["/docs/data/build/editors", "Editor"],
		]) {
			const context = await engine.newContext();
			try {
				const page = await context.newPage();
				const loaded = new Set();
				page.on("request", (request) => {
					const path = new URL(request.url()).pathname.split("/_next/")[1];
					if (path) loaded.add(path);
				});
				await page.goto(app.url + path);
				await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
				if (lesson)
					await expect(
						page.getByRole("textbox", { name: "Notes", exact: true }),
					).toBeVisible();
				await page.waitForLoadState("networkidle");
				if (!lesson) {
					assert.deepEqual(
						[...loaded].filter((file) => experimentFiles.has(file)),
						[],
						"prose does not load experiment code",
					);
				} else {
					const editor = new Set(filesFor("Lab.tsx -> ./labs/Editor"));
					for (const file of editor)
						assert.ok(loaded.has(file), "editor loads its dependencies");
					for (const file of filesFor("Lab.tsx -> ./labs/Planning")) {
						if (!editor.has(file))
							assert.ok(
								!loaded.has(file),
								"editor does not load planning simulation",
							);
					}
				}
			} finally {
				await context.close();
			}
		}
	} finally {
		await engine.close();
		await app.close();
	}
});
