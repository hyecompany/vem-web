// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	cp,
	glob,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
	await readFile(join(root, "package-lock.json"), "utf8"),
);
const manifest = JSON.parse(
	await readFile(join(root, "packages/data/package.json"), "utf8"),
);
const tarball = await realpath(
	resolve(root, `hyecompany-vem-data-${manifest.version}.tgz`),
);
const npm = [
	process.env.npm_execpath,
	join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
	resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
].find((path) => path && existsSync(path));
if (!npm) throw Error("Run this check through npm so its CLI can be located.");
const tempRoot = await realpath(tmpdir());
const directory = await mkdtemp(join(tempRoot, "vem-package-consumer-"));
const dependencies = Object.fromEntries(
	[
		"react",
		"react-dom",
		"@types/react",
		"@types/react-dom",
		"@types/node",
		"typescript",
		"vite",
	].map((name) => {
		const version = [
			"node_modules",
			"packages/data/node_modules",
			"packages/docs/node_modules",
		]
			.map((prefix) => lock.packages[`${prefix}/${name}`]?.version)
			.find(Boolean);
		if (!version) throw Error(`Missing locked dependency ${name}`);
		return [name, version];
	}),
);
async function run(file, args, environment = {}) {
	await new Promise((done, fail) => {
		const child = spawn(file, args, {
			cwd: directory,
			stdio: "inherit",
			windowsHide: true,
			env: { ...process.env, NODE_PATH: "", ...environment },
		});
		child.once("error", fail);
		child.once("exit", (code) =>
			code === 0 ? done() : fail(Error(`${basename(file)} exited ${code}`)),
		);
	});
}
try {
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			name: "vem-independent-task-board",
			private: true,
			type: "module",
			dependencies: {
				"@hyecompany/vem-data": `file:${tarball.replaceAll("\\", "/")}`,
				...dependencies,
			},
		}),
	);
	await run(process.execPath, [
		npm,
		"install",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--cache",
		join(directory, "npm-cache"),
	]);
	const installed = JSON.parse(
		await readFile(
			join(directory, "node_modules/@hyecompany/vem-data/package.json"),
			"utf8",
		),
	);
	const entries = Object.keys(installed.exports).map((key) =>
		key === "." ? installed.name : installed.name + key.slice(1),
	);
	await writeFile(
		join(directory, "imports.mjs"),
		entries
			.map((entry) => `await import(${JSON.stringify(entry)});`)
			.join("\n"),
	);
	await run(process.execPath, ["imports.mjs"]);
	await cp(
		join(directory, "node_modules/@hyecompany/vem-data/examples"),
		join(directory, "examples"),
		{
			recursive: true,
			filter: (path) => !path.split(sep).some((part) => part === ".build"),
		},
	);
	await writeFile(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				lib: ["ES2023", "DOM", "DOM.Iterable"],
				jsx: "react-jsx",
				strict: true,
				noUncheckedIndexedAccess: true,
				skipLibCheck: false,
				noEmit: true,
				types: ["react", "node", "vite/client"],
			},
			include: ["examples/**/*.ts", "examples/**/*.tsx"],
		}),
	);
	await run(process.execPath, [
		join(directory, "node_modules/typescript/bin/tsc"),
		"--project",
		"tsconfig.json",
	]);
	await run(process.execPath, [
		join(directory, "node_modules/vite/bin/vite.js"),
		"build",
		"--config",
		"examples/task-board/vite.config.ts",
	]);
	await run(
		process.execPath,
		[
			"--test",
			"--test-concurrency=1",
			...(
				await Array.fromAsync(
					glob("tests/package/**/*.test.mjs", {
						cwd: root,
						exclude: ["tests/package/ui/**"],
					}),
				)
			).map((file) => join(root, file)),
		],
		{ VEM_STARTER_DIRECTORY: join(directory, "examples/task-board") },
	);
	console.log(
		`Verified ${entries.length} public entries, typed examples, built worker, and the independent two-tab starter.`,
	);
} finally {
	const target = await realpath(directory);
	if (
		dirname(target) !== tempRoot ||
		!basename(target).startsWith("vem-package-consumer-")
	) {
		console.error(
			`Refusing to remove unexpected temporary directory ${target}`,
		);
		process.exitCode = 1;
	} else await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
