// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Next's client uses dot-separated segment names on every platform. */
export async function normalizeSegments(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	let count = 0;
	async function flatten(source, prefix) {
		for (const entry of await readdir(source, { withFileTypes: true })) {
			const path = resolve(source, entry.name);
			const name = `${prefix}.${entry.name}`;
			if (entry.isDirectory()) await flatten(path, name);
			else if (entry.name.endsWith(".txt")) {
				const target = resolve(directory, name);
				try {
					const [actual, expected] = await Promise.all([
						readFile(target),
						readFile(path),
					]);
					if (!actual.equals(expected))
						throw Error(`Conflicting segment export: ${target}`);
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
					await copyFile(path, target);
					count++;
				}
			}
		}
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const path = resolve(directory, entry.name);
		if (entry.name.startsWith("__next.")) await flatten(path, entry.name);
		else count += await normalizeSegments(path);
	}
	return count;
}

export const redirects = {
	"ui/reference/api/index.Variable.Combobox":
		"ui/reference/api/index.Function.Combobox",
	"ui/registry": "ui",
	"ui/overflow-text": "ui/components/overflow-text",
	"ui/spinner": "ui/components/spinner",
	"ui/reference/api/Function.OverflowText":
		"ui/reference/api/index.Function.OverflowText",
	"ui/reference/api/Function.Spinner":
		"ui/reference/api/index.Function.Spinner",
	"ui/reference/api/TypeAlias.OverflowTextProps":
		"ui/reference/api/index.TypeAlias.OverflowTextProps",
	"ui/reference/api/TypeAlias.SpinnerProps":
		"ui/reference/api/index.TypeAlias.SpinnerProps",
	"ui/components/picker": "ui/components/combobox",
	"ui/components/navigation": "ui/components/sidebar",
	"ui/components/select": "ui/components/combobox",
	"ui/components/use-mobile": "ui/components/sidebar",
};

export async function finalizeExport(out, base = "") {
	const normalized = await normalizeSegments(out);
	for (const [previous, current] of Object.entries(redirects)) {
		const target = `${base}/docs/${current}/`;
		const file = resolve(out, "docs", previous, "index.html");
		if (!file.startsWith(resolve(out) + sep))
			throw Error("Redirect escaped export");
		await readFile(resolve(out, "docs", current, "index.html"));
		await mkdir(dirname(file), { recursive: true });
		await writeFile(
			file,
			`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="https://hyevem.com/docs/${current}/"><title>Page moved | Hye Vem</title></head><body><main><h1>Page moved</h1><p>Continue to <a href="${target}">the updated Vem UI documentation</a>.</p></main></body></html>`,
		);
	}
	return normalized;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const out = resolve(import.meta.dirname, "../out");
	const { basePath } = JSON.parse(
		await readFile(resolve(out, "deployment.json"), "utf8"),
	);
	console.log(
		`Prepared static redirects and normalized ${await finalizeExport(out, basePath)} segment files.`,
	);
}
