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

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
	await readFile(join(root, "package-lock.json"), "utf8"),
);
const manifest = JSON.parse(
	await readFile(join(root, "packages/ui/package.json"), "utf8"),
);
const dataManifest = JSON.parse(
	await readFile(join(root, "packages/data/package.json"), "utf8"),
);
const npm = [
	process.env.npm_execpath,
	join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
	resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
].find((path) => path && existsSync(path));
if (!npm) throw Error("Run this check through npm so its CLI can be located.");
const tempRoot = await realpath(tmpdir());
const directory = await mkdtemp(join(tempRoot, "vem-ui-consumer-"));
async function run(file, args, cwd = directory, environment = {}) {
	await new Promise((done, fail) => {
		const child = spawn(file, args, {
			cwd,
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
	await run(
		process.execPath,
		[npm, "run", "build", "--workspace", "@hyecompany/vem-data"],
		root,
	);
	await run(
		process.execPath,
		[join(root, "packages/ui/scripts/build.mjs")],
		root,
	);
	await run(
		process.execPath,
		[
			npm,
			"pack",
			"--silent",
			"--workspace",
			"@hyecompany/vem-ui",
			"--pack-destination",
			directory,
		],
		root,
	);
	const dependencies = Object.fromEntries(
		[
			"react",
			"react-dom",
			"@types/react",
			"@types/react-dom",
			"typescript",
			"vite",
		].map((name) => {
			const version = [
				"node_modules",
				"packages/ui/node_modules",
				"packages/docs/node_modules",
				"packages/data/node_modules",
			]
				.map((prefix) => lock.packages[`${prefix}/${name}`]?.version)
				.find(Boolean);
			if (!version) throw Error(`Missing locked dependency ${name}`);
			return [name, version];
		}),
	);
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			name: "vem-ui-independent-consumer",
			private: true,
			type: "module",
			dependencies: {
				"@hyecompany/vem-ui": `file:./hyecompany-vem-ui-${manifest.version}.tgz`,
				react: dependencies.react,
				"react-dom": dependencies["react-dom"],
			},
			devDependencies: {
				"@types/react": dependencies["@types/react"],
				"@types/react-dom": dependencies["@types/react-dom"],
				typescript: dependencies.typescript,
				vite: dependencies.vite,
			},
		}),
	);
	await run(process.execPath, [
		npm,
		"install",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
	]);
	const installed = join(directory, "node_modules/@hyecompany/vem-ui");
	const installedManifest = JSON.parse(
		await readFile(join(installed, "package.json"), "utf8"),
	);
	assert.equal(installedManifest.license, "Apache-2.0 AND MIT");
	assert.match(
		await readFile(join(installed, "LICENSE"), "utf8"),
		/Apache License/,
	);
	assert.equal(
		(
			await readFile(join(installed, "THIRD-PARTY-NOTICES.txt"), "utf8")
		).replaceAll("\r\n", "\n"),
		(await readFile(join(root, "LICENSES/MIT.txt"), "utf8")).replaceAll(
			"\r\n",
			"\n",
		),
		"The packed UI must include the complete original shadcn MIT notice",
	);
	await cp(join(root, "tests/package/ui"), directory, {
		recursive: true,
		filter: (path) => !path.endsWith(".test.mjs"),
	});
	await cp(
		join(root, "packages/ui/tests/types.tsx"),
		join(directory, "types.tsx"),
	);
	await cp(
		join(directory, "node_modules/@hyecompany/vem-ui/examples"),
		join(directory, "examples"),
		{
			recursive: true,
			filter: async (path) =>
				!path.endsWith(".tsx") ||
				!/@hyecompany\/vem-(?:data|ui\/data)/.test(
					await readFile(path, "utf8"),
				),
		},
	);
	if (existsSync(join(directory, "node_modules/@hyecompany/vem-data")))
		throw Error("UI unexpectedly installed the optional Data peer");
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
				noEmit: true,
				skipLibCheck: false,
			},
			include: ["*.tsx", "examples/*.tsx"],
		}),
	);
	await run(process.execPath, [
		join(directory, "node_modules/typescript/bin/tsc"),
		"-p",
		"tsconfig.json",
	]);
	await run(process.execPath, [
		"--input-type=module",
		"-e",
		"import { createElement } from 'react'; import { renderToString } from 'react-dom/server'; import { OverflowText, Spinner } from '@hyecompany/vem-ui'; renderToString(createElement(OverflowText, { text: 'SSR outside a framework' })); renderToString(createElement(Spinner));",
	]);
	await run(process.execPath, [
		join(directory, "node_modules/vite/bin/vite.js"),
		"build",
	]);
	await run(
		process.execPath,
		["--test", join(root, "tests/package/ui/components.test.mjs")],
		root,
		{ VEM_UI_CONSUMER: directory },
	);
	await run(
		process.execPath,
		["--test", join(root, "tests/package/ui/production.test.mjs")],
		root,
		{ VEM_UI_CONSUMER: directory, VEM_UI_PHASE: "core" },
	);
	await run(
		process.execPath,
		[
			npm,
			"pack",
			"--silent",
			"--workspace",
			"@hyecompany/vem-data",
			"--pack-destination",
			directory,
		],
		root,
	);
	await run(process.execPath, [
		npm,
		"install",
		`./hyecompany-vem-data-${dataManifest.version}.tgz`,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
	]);
	await run(process.execPath, [
		"--input-type=module",
		"-e",
		"import { DataInspector } from '@hyecompany/vem-ui/devtools'; if (typeof DataInspector !== 'function') throw Error('Missing inspector export');",
	]);
	await cp(
		join(directory, "node_modules/@hyecompany/vem-ui/examples"),
		join(directory, "examples"),
		{ recursive: true },
	);
	await run(process.execPath, [
		join(directory, "node_modules/typescript/bin/tsc"),
		"-p",
		"tsconfig.json",
	]);
	await run(
		process.execPath,
		["--test", join(root, "tests/package/ui/production.test.mjs")],
		root,
		{ VEM_UI_CONSUMER: directory, VEM_UI_PHASE: "data" },
	);
	console.log(
		"Verified packed UI public imports, types, CSS without Tailwind, server rendering, hydration, Unicode, resizing, and motion preferences.",
	);
} finally {
	const target = await realpath(directory);
	if (
		dirname(target) !== tempRoot ||
		!basename(target).startsWith("vem-ui-consumer-")
	) {
		console.error(
			`Refusing to remove unexpected temporary directory ${target}`,
		);
		process.exitCode = 1;
	} else await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
