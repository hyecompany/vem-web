// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { changedFiles, selectValidation } from "./lib/affected-validation.mjs";
import { createTaskRunner } from "./lib/validation-runner.mjs";

const root = resolve(import.meta.dirname, "..");
const npm = [
	process.env.npm_execpath,
	join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
].find((path) => path && existsSync(path));
if (!npm) throw Error("Run validation through npm.");
const temporary = await realpath(tmpdir());
const timings = [];
let artifacts;
async function run(args, cwd = root, env = {}) {
	await new Promise((done, fail) => {
		const child = spawn(process.execPath, args, {
			cwd,
			windowsHide: true,
			stdio: "inherit",
			env: { ...process.env, ...env },
		});
		child.once("error", fail);
		child.once("exit", (code) =>
			code === 0
				? done()
				: fail(
						Error(
							`Validation command${env.VEM_BROWSER ? ` [${env.VEM_BROWSER}]` : ""} failed (${code}): ${args.join(" ")}`,
						),
					),
		);
	});
}
const npmRun = (name, workspace) => () =>
	run([
		npm,
		"run",
		name,
		...(workspace ? ["--workspace", `@hyecompany/vem-${workspace}`] : []),
	]);
const node =
	(...args) =>
	() =>
		run(args);
const tests = (...files) => node("--test", ...files);
const grouped = (...needs) => ({ needs });
const consumer = (file) => () =>
	run([file], root, { VEM_TEST_ARTIFACTS: artifacts });
const tasks = {
	check: { run: npmRun("check") },
	"build:data": { run: npmRun("build", "data") },
	"build:ui": { needs: ["build:data"], run: npmRun("build", "ui") },
	data: { run: npmRun("test", "data") },
	"data:validate": grouped("types:data", "data"),
	react: { run: npmRun("test:react") },
	"ui:unit": {
		needs: ["build:ui"],
		run: () =>
			run(
				[
					"--test",
					"tests/server.test.mjs",
					"tests/data/package-split.test.mjs",
				],
				join(root, "packages/ui"),
			),
	},
	workflows: { run: tests("tests/github/**/*.test.mjs") },
	maintenance: { run: npmRun("test:ui-maintenance") },
	unit: grouped("data", "react", "ui:unit", "workflows", "maintenance"),
	"types:data": { run: npmRun("typecheck", "data") },
	"types:ui": {
		needs: ["build:ui"],
		run: () =>
			run([
				npm,
				"exec",
				"--workspace",
				"@hyecompany/vem-ui",
				"--",
				"tsc",
				"-p",
				"tsconfig.test.json",
			]),
	},
	"docs:prepare": {
		needs: ["build:ui"],
		run: async () => {
			await run(["scripts/generate-docs.mjs"]);
		},
	},
	"types:docs": { needs: ["docs:prepare"], run: npmRun("typecheck", "docs") },
	types: grouped("types:data", "types:ui", "types:docs"),
	"react:validate": grouped("types:data", "types:ui", "react"),
	"docs:build": { needs: ["types:docs"], run: npmRun("build", "docs") },
	"docs:validate": {
		needs: ["types:docs", "docs:build"],
		run: tests("--test-concurrency=2", "tests/docs/**/*.test.mjs"),
	},
	browser: {
		needs: ["build:ui"],
		run: () =>
			run(
				[
					"--test",
					"--test-concurrency=1",
					"tests/browser/*.test.mjs",
					"tests/data/browser.test.mjs",
				],
				join(root, "packages/ui"),
			),
	},
	"browser:all": {
		needs: ["build:ui"],
		run: async () => {
			const results = await Promise.allSettled(
				["chromium", "firefox", "webkit"].map((engine) =>
					run(
						[
							"--test",
							"--test-concurrency=1",
							"tests/browser/*.test.mjs",
							"tests/data/browser.test.mjs",
						],
						join(root, "packages/ui"),
						{ VEM_BROWSER: engine },
					),
				),
			);
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Browser validation failed",
				);
		},
	},
	ui: grouped("react", "ui:unit", "browser"),
	artifacts: {
		needs: ["build:ui"],
		run: async () => {
			artifacts = await mkdtemp(join(temporary, "vem-validation-"));
			for (const id of ["data", "ui"])
				await run([
					npm,
					"pack",
					"--silent",
					"--workspace",
					`@hyecompany/vem-${id}`,
					"--pack-destination",
					artifacts,
				]);
		},
	},
	"package:data": {
		needs: ["artifacts"],
		run: consumer("scripts/check-package.mjs"),
	},
	"package:ui": {
		needs: ["artifacts"],
		run: consumer("scripts/check-ui-package.mjs"),
	},
	"package:next": {
		needs: ["artifacts"],
		run: consumer("docs/scripts/check-packed-next.mjs"),
	},
	packages: grouped("package:data", "package:ui"),
	all: grouped(
		"check",
		"types",
		"unit",
		"browser:all",
		"packages",
		"package:next",
		"docs:validate",
	),
};
for (const [name, task] of Object.entries(tasks)) {
	if (!task.run) continue;
	const action = task.run;
	task.run = async () => {
		console.log(`\n[validate] ${name}`);
		const started = performance.now();
		try {
			await action();
		} finally {
			timings.push([name, ((performance.now() - started) / 1000).toFixed(1)]);
		}
	};
}
const execute = createTaskRunner(tasks);
try {
	const [target = "unit", ...args] = process.argv.slice(2);
	if (target === "affected") {
		if (args.length && (args.length !== 2 || args[0] !== "--base"))
			throw Error("Usage: npm run test:affected -- [--base <git-ref>]");
		const selection = selectValidation(
			changedFiles(args[1] ?? process.env.VEM_TEST_BASE ?? "origin/main"),
		);
		console.log(
			`[validate] Selected: ${selection.targets.join(", ")}\n${selection.reasons.join("\n")}`,
		);
		await execute("check");
		for (const selected of selection.targets) await execute(selected);
	} else {
		if (args.length) throw Error(`Unexpected arguments: ${args.join(" ")}`);
		await execute(target);
	}
} finally {
	console.log(
		`\nValidation timings (seconds):\n${timings.map(([name, seconds]) => `${name}: ${seconds}`).join("\n")}`,
	);
	if (
		artifacts &&
		dirname(artifacts) === temporary &&
		basename(artifacts).startsWith("vem-validation-")
	)
		await rm(artifacts, { recursive: true, force: true, maxRetries: 3 });
}
