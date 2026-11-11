// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, expect, firefox } from "@playwright/test";
import { build } from "vite";

async function fixture() {
	const source = fileURLToPath(
		new URL("./fixtures/transfers", import.meta.url),
	);
	const parent = process.env.VEM_STARTER_DIRECTORY
		? resolve(process.env.VEM_STARTER_DIRECTORY, "../..")
		: resolve(import.meta.dirname, "../..");
	const directory = await mkdtemp(join(parent, ".transfer-test-"));
	await cp(source, directory, { recursive: true });
	await writeFile(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				lib: ["ES2023", "DOM", "DOM.Iterable"],
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				types: ["vite/client"],
			},
			include: ["*.ts"],
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
		configFile: false,
		root: directory,
		logLevel: "warn",
		worker: { format: "es" },
		build: {
			outDir: "out",
			rollupOptions: {
				input: {
					main: join(directory, "index.html"),
					transfers: join(directory, "transfers.ts"),
				},
				output: {
					entryFileNames: (chunk) =>
						chunk.name === "transfers"
							? "transfers.js"
							: "assets/[name]-[hash].js",
				},
			},
		},
	});
	let release = () => {};
	let received = 0;
	let posts = 0;
	let requestHeaders;
	let complete;
	const finished = new Promise((resolve) => {
		complete = resolve;
	});
	const server = createServer((request, response) => {
		if (request.url === "/upload" && request.method === "POST") {
			posts++;
			requestHeaders = request.headers;
			let paused = false;
			request.on("data", (chunk) => {
				received += chunk.length;
				if (!paused) {
					paused = true;
					request.pause();
					release = () => request.resume();
				}
			});
			request.on("end", () => {
				response.writeHead(200, { "Content-Type": "text/plain" });
				response.end("stored");
				complete();
			});
			return;
		}
		const path = new URL(request.url, "http://fixture").pathname;
		const file = resolve(
			directory,
			"out",
			`.${path === "/" ? "/index.html" : path}`,
		);
		if (!file.startsWith(resolve(directory, "out") + sep)) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.setHeader(
			"Content-Type",
			file.endsWith(".js") ? "text/javascript" : "text/html",
		);
		response.setHeader("Cache-Control", "no-store");
		const stream = createReadStream(file);
		stream.on("error", () => {
			response.writeHead(404);
			response.end();
		});
		stream.pipe(response);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		finished,
		release: () => release(),
		get received() {
			return received;
		},
		get posts() {
			return posts;
		},
		get headers() {
			return requestHeaders;
		},
		async close() {
			release();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			assert.equal(dirname(directory), parent);
			await rm(directory, { recursive: true, force: true, maxRetries: 3 });
		},
	};
}

async function connected(page, url) {
	await page.goto(url);
	await expect
		.poll(() =>
			page.evaluate(() => window.fixture?.client.connectionSnapshot().phase),
		)
		.toBe("ready");
}

test("browser-managed upload survives the final tab and recovers the same action without replay", {
	timeout: 120_000,
}, async () => {
	const app = await fixture();
	let browser;
	try {
		browser = await chromium.launch({
			headless: true,
			channel: "chromium",
		});
		const context = await browser.newContext();
		const errors = [];
		context.on("page", (page) =>
			page.on("pageerror", (error) => errors.push(error.message)),
		);
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send("Browser.setPermission", {
			permission: { name: "background-fetch" },
			browserContextId: (await cdp.send("Target.getTargetInfo")).targetInfo
				.browserContextId,
			setting: "granted",
			origin: app.url,
		});
		await context.addCookies([
			{ name: "fixture-auth", value: "present", url: app.url },
		]);
		await connected(page, app.url);
		const second = await context.newPage();
		await connected(second, app.url);
		const bytes = 8 * 1024 * 1024;
		const id = await page.evaluate((bytes) => window.fixture.run(bytes), bytes);
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const s = window.transferHandle.getSnapshot();
						if (s.phase === "settled") throw new Error(JSON.stringify(s));
						return s.execution;
					}),
				{ timeout: 40_000 },
			)
			.toMatchObject({ lifetime: "browser" });
		await expect
			.poll(() =>
				second.evaluate(
					(id) =>
						window.fixture.client
							.listActivities()
							.some(
								(action) =>
									action.id === id && action.execution?.lifetime === "browser",
							),
					id,
				),
			)
			.toBe(true);
		await expect.poll(() => app.received).toBeGreaterThan(0);
		assert.ok(app.received < bytes);
		await page.close();
		await second.close();
		assert.equal(context.pages().length, 0);
		app.release();
		await app.finished;
		assert.equal(app.received, bytes);
		assert.equal(app.posts, 1);
		assert.equal(app.headers["x-transfer-test"], "yes");
		assert.match(app.headers.cookie, /fixture-auth=present/);
		const reopened = await context.newPage();
		await connected(reopened, app.url);
		await expect
			.poll(
				() =>
					reopened.evaluate(
						(id) =>
							window.fixture.client
								.listActivities()
								.find((action) => action.id === id)?.outcome?.kind,
						id,
					),
				{ timeout: 40_000 },
			)
			.toBe("succeeded");
		assert.equal(app.posts, 1, "restoration never repeats an upload");
		assert.deepEqual(errors, []);
	} finally {
		try {
			await browser?.close();
		} finally {
			await app.close();
		}
	}
});

test("a browser without Background Fetch executes the same command with an explicit open-tab lifetime", {
	timeout: 120_000,
}, async () => {
	const app = await fixture();
	let browser;
	try {
		browser = await firefox.launch({ headless: true });
		const page = await browser.newPage();
		await connected(page, app.url);
		await page.evaluate(() => window.fixture.run(1024));
		await expect.poll(() => app.received).toBeGreaterThan(0);
		const execution = await page.evaluate(() => {
			const s = window.transferHandle.getSnapshot();
			if (s.phase === "settled") throw new Error(JSON.stringify(s));
			return s.execution;
		});
		assert.equal(execution.lifetime, "owner");
		assert.match(execution.reason, /tab.*open/i);
		app.release();
		await expect
			.poll(() =>
				page.evaluate(() => window.transferHandle.getSnapshot().outcome?.kind),
			)
			.toBe("succeeded");
		assert.equal(app.posts, 1);
	} finally {
		try {
			await browser?.close();
		} finally {
			await app.close();
		}
	}
});

test("explicit browser transfer cancellation is acknowledged without claiming remote rollback", {
	timeout: 120_000,
}, async () => {
	const app = await fixture();
	let browser;
	try {
		browser = await chromium.launch({
			headless: true,
			channel: "chromium",
		});
		const context = await browser.newContext();
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send("Browser.setPermission", {
			permission: { name: "background-fetch" },
			setting: "granted",
			origin: app.url,
			browserContextId: (await cdp.send("Target.getTargetInfo")).targetInfo
				.browserContextId,
		});
		await connected(page, app.url);
		await page.evaluate(() => window.fixture.run(8 * 1024 * 1024));
		await expect
			.poll(() =>
				page.evaluate(
					() => window.transferHandle.getSnapshot().execution?.lifetime,
				),
			)
			.toBe("browser");
		await expect.poll(() => app.received).toBeGreaterThan(0);
		await page.evaluate(() => window.transferHandle.cancel());
		await expect
			.poll(
				() =>
					page.evaluate(
						() => window.transferHandle.getSnapshot().outcome?.kind,
					),
				{ timeout: 40_000 },
			)
			.toBe("unknown");
		const outcome = await page.evaluate(
			() => window.transferHandle.getSnapshot().outcome,
		);
		assert.match(outcome.message, /partial|complete response/);
		assert.equal(app.posts, 1);
	} finally {
		try {
			await browser?.close();
		} finally {
			await app.close();
		}
	}
});
