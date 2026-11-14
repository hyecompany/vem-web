// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import { fileSources, repository } from "./ui-upstream.mjs";

// REUSE-IgnoreStart
const snippets = (text) =>
	[
		...text.matchAll(
			/[^\n]*SPDX-SnippetBegin[\s\S]*?[^\n]*SPDX-SnippetEnd[^\n]*/g,
		),
	].map(([value]) => value);
const notices = (text) =>
	text
		.split("\n")
		.filter((line) =>
			/SPDX-FileCopyrightText:|SPDX-License-Identifier:|SPDX-SnippetCopyrightText:/.test(
				line,
			),
		);
// REUSE-IgnoreEnd
export async function mergeSource(local, before, after) {
	const temporary = await realpath(tmpdir());
	const directory = await mkdtemp(resolve(temporary, "vem-upstream-merge-"));
	if (dirname(directory) !== temporary)
		throw Error("Unexpected merge directory");
	try {
		const paths = ["local", "base", "upstream"].map((name) =>
			resolve(directory, name),
		);
		await Promise.all(
			paths.map((path, index) =>
				writeFile(path, [local, before, after][index]),
			),
		);
		const merged = spawnSync(
			"git",
			["merge-file", "--stdout", "--diff3", ...paths],
			{ encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
		);
		if (merged.error) throw merged.error;
		if (merged.status === null || merged.status < 0 || merged.status > 127)
			throw Error(merged.stderr || "Merge failed");
		if (merged.status !== 0)
			return { reason: "The upstream changes overlap local adaptations." };
		if (
			JSON.stringify(snippets(local)) !==
				JSON.stringify(snippets(merged.stdout)) ||
			JSON.stringify(notices(local)) !== JSON.stringify(notices(merged.stdout))
		)
			return {
				reason:
					"The merge changes attributed local snippets or license notices and needs a human review.",
			};
		return { content: merged.stdout };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function prepareUpdate(
	source,
	revision,
	before,
	after,
	read = (file) => readFile(resolve(repository, file), "utf8"),
) {
	if (after === null)
		return {
			reason: "The upstream file was removed; its replacement needs review.",
		};
	const files = [];
	for (const path of source.files) {
		if (extname(path) !== extname(source.path))
			return {
				reason:
					"This source generates a different file format; applying its changes requires reviewing the generated styling.",
			};
		const local = (await read(path)).replaceAll("\r\n", "\n");
		const result = await mergeSource(local, before, after);
		if (result.reason) return { reason: `${path}: ${result.reason}` };
		const url = source.url.replace(source.revision, revision);
		const content = result.content.replaceAll(source.url, url);
		const sources = fileSources(content, path);
		if (!sources.some((item) => item.url === url))
			throw Error(`Missing updated source in ${path}`);
		files.push({ path, content });
	}
	return { files };
}
