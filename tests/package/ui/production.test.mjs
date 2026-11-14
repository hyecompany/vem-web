// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { expect } from "@playwright/test";
import { browser } from "../../support/browser.mjs";

const fixture = process.env.VEM_UI_CONSUMER;
test("packed production consumers request only their used UI and Data implementation", {
	skip: !fixture,
}, async (t) => {
	const core = process.env.VEM_UI_PHASE === "core";
	if (core)
		assert.equal(
			existsSync(join(fixture, "node_modules/@hyecompany/vem-data")),
			false,
		);
	const { productionConsumer } = await import(
		pathToFileURL(join(fixture, "production.mjs")).href
	);
	const engine = await browser();
	try {
		for (const kind of core ? ["button"] : ["command", "editor"]) {
			const app = await productionConsumer(kind);
			const page = await engine.newPage();
			const requested = new Set();
			const errors = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("request", (request) => {
				if (request.resourceType() === "script")
					requested.add(new URL(request.url()).pathname.slice(1));
			});
			try {
				await page.goto(app.url);
				if (kind === "button")
					await expect(
						page.getByRole("button", { name: "Core consumer" }),
					).toBeEnabled();
				if (kind === "command")
					await expect(
						page.getByRole("button", { name: "Complete task" }),
					).toBeDisabled();
				if (kind === "editor") {
					await expect(
						page.getByRole("textbox", { name: "Notes" }),
					).toHaveValue("Packed editor");
					await page
						.getByRole("textbox", { name: "Notes" })
						.fill("Edited locally");
				}
				const chunks = app.chunks.filter((chunk) =>
					requested.has(chunk.fileName),
				);
				assert.ok(chunks.length > 0);
				const modules = chunks.flatMap((chunk) => chunk.modules);
				assert.equal(
					modules.some((path) =>
						/@tanstack\/(?:react-virtual|virtual-core)|\/(?:combobox-virtual-list|virtual-list)\.js$/.test(
							path,
						),
					),
					false,
					`${kind} excludes unused virtualization`,
				);
				assert.equal(
					modules.some((path) =>
						/(?:dexie|xstate|@tanstack\/db|\/data\/dist\/runtime(?:\/|\.))/.test(
							path,
						),
					),
					false,
					kind,
				);
				if (kind === "button")
					assert.equal(
						modules.some((path) => path.includes("/vem-data/")),
						false,
					);
				if (kind === "command")
					assert.equal(
						modules.some((path) =>
							/\/(?:edit|react-feedback|activity-toasts)\.js$/.test(path),
						),
						false,
					);
				if (kind === "editor")
					assert.equal(
						modules.some((path) =>
							/\/(?:command-button|react-feedback|activity-toasts)\.js$/.test(
								path,
							),
						),
						false,
					);
				t.diagnostic(
					`${kind}: ${chunks.length} requested JS chunks, ${chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk.code), 0)} bytes / ${chunks.reduce((total, chunk) => total + gzipSync(chunk.code).length, 0)} gzip bytes / ${chunks.reduce((total, chunk) => total + brotliCompressSync(chunk.code).length, 0)} Brotli bytes including React`,
				);
				t.diagnostic(
					`${kind}: ${app.styles.reduce((total, style) => total + Buffer.byteLength(style.source), 0)} CSS bytes / ${app.styles.reduce((total, style) => total + gzipSync(style.source).length, 0)} gzip CSS bytes / ${app.styles.reduce((total, style) => total + brotliCompressSync(style.source).length, 0)} Brotli CSS bytes`,
				);
				assert.deepEqual(errors, []);
			} finally {
				await page.close();
				await app.close();
			}
		}
	} finally {
		await engine.close();
	}
});
