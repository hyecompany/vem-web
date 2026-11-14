// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	cp,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { serve } from "../../../tests/docs/support/site.mjs";
import { browser } from "../../../tests/support/browser.mjs";
import { normalizeSegments } from "./finalize-export.mjs";

const root = resolve(import.meta.dirname, "../../..");
const npm = [
	process.env.npm_execpath,
	join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
	resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
].find((path) => path && existsSync(path));
if (!npm) throw Error("Run through npm so its CLI can be located.");
const tempRoot = await realpath(tmpdir());
const directory = await mkdtemp(join(tempRoot, "vem-next-consumer-"));
const lock = JSON.parse(
	await readFile(join(root, "package-lock.json"), "utf8"),
);
async function run(args, cwd = directory) {
	await new Promise((done, fail) => {
		const child = spawn(process.execPath, args, {
			cwd,
			stdio: "inherit",
			windowsHide: true,
			env: { ...process.env, NODE_PATH: "" },
		});
		child.once("error", fail);
		child.once("exit", (code) =>
			code === 0 ? done() : fail(Error(`Consumer command exited ${code}`)),
		);
	});
}
let app, engine;
try {
	const dependencies = {};
	for (const id of ["data", "ui"]) {
		const manifest = JSON.parse(
			await readFile(join(root, `packages/${id}/package.json`), "utf8"),
		);
		await run(
			[
				npm,
				"pack",
				"--silent",
				"--workspace",
				manifest.name,
				"--pack-destination",
				directory,
			],
			root,
		);
		dependencies[manifest.name] =
			`file:./hyecompany-vem-${id}-${manifest.version}.tgz`;
	}
	for (const name of [
		"next",
		"react",
		"react-dom",
		"typescript",
		"@types/react",
		"@types/react-dom",
		"@types/node",
	]) {
		const version = [
			"node_modules",
			"packages/docs/node_modules",
			"packages/ui/node_modules",
			"packages/data/node_modules",
		]
			.map((prefix) => lock.packages[`${prefix}/${name}`]?.version)
			.find(Boolean);
		if (!version) throw Error(`Missing locked dependency ${name}`);
		dependencies[name] = version;
	}
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			name: "vem-independent-next-consumer",
			private: true,
			type: "module",
			dependencies,
		}),
	);
	await run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"]);
	await cp(join(root, "tests/docs/packed/app"), join(directory, "app"), {
		recursive: true,
	});
	await cp(
		join(directory, "node_modules/@hyecompany/vem-ui/examples"),
		join(directory, "examples"),
		{ recursive: true },
	);
	await writeFile(
		join(directory, "next.config.mjs"),
		"export default {output:'export',trailingSlash:true,agentRules:false,basePath:'/consumer',experimental:{extensionAlias:{'.js':['.ts','.tsx','.js']}}};",
	);
	await writeFile(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				lib: ["dom", "dom.iterable", "esnext"],
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				module: "esnext",
				moduleResolution: "bundler",
				jsx: "react-jsx",
				esModuleInterop: true,
				plugins: [{ name: "next" }],
			},
			include: ["**/*.ts", "**/*.tsx"],
			exclude: ["node_modules"],
		}),
	);
	await run([
		join(directory, "node_modules/next/dist/bin/next"),
		"build",
		"--webpack",
	]);
	const out = join(directory, "out");
	await normalizeSegments(out);
	const html = await readFile(join(out, "index.html"), "utf8");
	assert.match(html, /Rendered on the server/);
	assert.match(html, /Save task/);
	assert.doesNotMatch(html, /D:\\repos|packages\/ui\/src/);
	app = await serve({ directory: out, basePath: "/consumer" });
	engine = await browser();
	const page = await engine.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto(`${app.url}/`);
	await page.getByRole("button", { name: "Save task", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Saved");
	const setting = page.getByRole("switch", { name: "Show completed tasks" });
	await setting.click();
	await expect(setting).toBeChecked();
	await page.getByRole("combobox", { name: "Board", exact: true }).click();
	await expect(
		page.getByRole("option", { name: "Work", exact: true }),
	).toBeVisible();
	const popup = page.locator('[data-slot="combobox-content"]');
	await expect(page.locator("html")).toHaveClass("dark");
	await expect(popup).toHaveCSS("color-scheme", "dark");
	const colors = await popup.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			background: style.backgroundColor,
			token: style.getPropertyValue("--popover").trim(),
		};
	});
	assert.ok(
		colors.background !== "rgba(0, 0, 0, 0)",
		"packed popup CSS is present",
	);
	assert.ok(colors.token, "popup inherits the document theme");
	await page.getByRole("option", { name: "Work", exact: true }).click();
	await expect(
		page.getByRole("combobox", { name: "Board", exact: true }),
	).toHaveValue("Work");
	await expect(page.getByText("Plan a walk", { exact: true })).toBeVisible();
	await page
		.getByRole("button", { name: "Complete task", exact: true })
		.click();
	assert.deepEqual(errors, []);
	console.log(
		"Verified packed Vem UI and Data in an independent Next application: server rendering, hydration, CSS, portals, public examples, and Data binding.",
	);
} finally {
	await engine?.close();
	await app?.close();
	const target = await realpath(directory);
	if (
		dirname(target) !== tempRoot ||
		!basename(target).startsWith("vem-next-consumer-")
	) {
		console.error(`Refusing unexpected cleanup: ${target}`);
		process.exitCode = 1;
	} else await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
