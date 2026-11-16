// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const alias = ["data", "ui"].flatMap((id) => {
	const directory = resolve(root, "packages", id);
	const manifest = JSON.parse(
		readFileSync(resolve(directory, "package.json"), "utf8"),
	);
	return Object.entries(manifest.exports).flatMap(([entry, value]) => {
		if (entry.endsWith(".css")) return [];
		const stem = resolve(
			directory,
			value.types.replace("./dist/", "src/").replace(/\.d\.ts$/, ""),
		);
		const source = [`${stem}.ts`, `${stem}.tsx`].find(existsSync);
		if (!source) throw Error(`Missing source for ${manifest.name}/${entry}`);
		const name = manifest.name + (entry === "." ? "" : entry.slice(1));
		return [
			{
				find: new RegExp(`^${name.replaceAll(".", "\\.")}$`),
				replacement: source,
			},
		];
	});
});

export default defineConfig({
	root,
	resolve: { alias },
	test: {
		name: "react",
		environment: "jsdom",
		include: ["packages/*/tests/react/**/*.test.tsx"],
		setupFiles: ["./tests/support/react.mjs"],
		restoreMocks: true,
		unstubGlobals: true,
		unstubEnvs: true,
	},
});
