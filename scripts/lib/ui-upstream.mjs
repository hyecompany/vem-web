// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";

export const repository = resolve(import.meta.dirname, "../..");
export const digest = (value) =>
	createHash("sha256").update(value).digest("hex");

export function parseSource(value) {
	const url = new URL(value);
	const match = url.pathname.match(
		/^\/([\w.-]+\/[\w.-]+)\/blob\/([a-f0-9]{40})\/(.+)$/,
	);
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.search ||
		url.hash ||
		!match
	)
		throw Error(
			`Source must link to a real GitHub file at a full commit SHA: ${value}`,
		);
	const [, repo, revision, path] = match;
	return { url: url.href, repo, revision, path, key: `${repo}/${path}` };
}
// REUSE-IgnoreStart
export function validateSnippets(text, file) {
	let open;
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (line.includes("SPDX-SnippetBegin")) {
			if (open !== undefined)
				throw Error(`${file}:${index + 1}: nested snippet`);
			open = index;
		}
		if (line.includes("SPDX-SnippetEnd")) {
			if (open === undefined)
				throw Error(`${file}:${index + 1}: unmatched snippet end`);
			const body = text.split(/\r?\n/).slice(open, index).join("\n");
			if (
				!/SPDX-SnippetCopyrightText:[ \t]*[^\s*]/.test(body) ||
				!/SPDX-License-Identifier:[ \t]*[^\s*]/.test(body)
			)
				throw Error(`${file}:${open + 1}: incomplete modification attribution`);
			open = undefined;
		}
	}
	if (open !== undefined) throw Error(`${file}: unclosed snippet`);
}
export function fileSources(text, file) {
	validateSnippets(text, file);
	const sources = [...text.matchAll(/\bSource:\s*(https:\/\/[^\s*]+)/g)].map(
		(match) => parseSource(match[1]),
	);
	if (/SPDX-FileCopyrightText:.*shadcn/.test(text) && sources.length === 0)
		throw Error(`${file}: adapted shadcn source requires a pinned Source URL`);
	if (sources.length) {
		const header = text.split("SPDX-SnippetBegin")[0];
		if (
			!header.includes("SPDX-FileCopyrightText:") ||
			!header.includes("SPDX-License-Identifier:")
		)
			throw Error(`${file}: preserve original file attribution and license`);
		if (!text.includes("SPDX-SnippetBegin"))
			throw Error(
				`${file}: package adaptations require attributed modification snippets`,
			);
	}
	return sources;
}
// REUSE-IgnoreEnd
export async function sources(
	directory = resolve(repository, "packages/ui/src"),
) {
	const found = new Map();
	async function visit(folder) {
		for (const entry of await readdir(folder, { withFileTypes: true })) {
			const file = resolve(folder, entry.name);
			if (entry.isDirectory()) await visit(file);
			else if (/\.(tsx?|css)$/.test(entry.name)) {
				for (const source of fileSources(await readFile(file, "utf8"), file)) {
					const previous = found.get(source.key);
					if (previous && previous.revision !== source.revision)
						throw Error(
							`Review ${source.key} consistently: files pin different upstream revisions`,
						);
					const item = previous ?? { ...source, files: [] };
					item.files.push(relative(repository, file).replaceAll("\\", "/"));
					found.set(source.key, item);
				}
			}
		}
	}
	await visit(directory);
	return [...found.values()];
}
export function chooseIssue(issues, source, hash) {
	const marker = `<!-- upstream-source:${source.key} -->`;
	const matching = issues.filter(
		(issue) => !issue.pull_request && issue.body?.includes(marker),
	);
	if (
		matching.some((issue) =>
			issue.body.includes(`<!-- upstream-content:${hash} -->`),
		)
	)
		return { kind: "unchanged" };
	const open = matching.find((issue) => issue.state === "open");
	return open ? { kind: "update", issue: open } : { kind: "create" };
}
export async function sourceDiff(before, after) {
	const temporary = await realpath(tmpdir());
	const directory = await mkdtemp(resolve(temporary, "vem-upstream-"));
	if (dirname(directory) !== temporary)
		throw Error("Unexpected temporary source directory");
	try {
		const oldPath = resolve(directory, "reviewed-source"),
			newPath = resolve(directory, "current-source");
		await writeFile(oldPath, before);
		await writeFile(newPath, after ?? "");
		const diff = spawnSync(
			"git",
			["diff", "--no-index", "--no-ext-diff", "--", oldPath, newPath],
			{ encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
		);
		if (diff.error) throw diff.error;
		if (![0, 1].includes(diff.status)) throw Error(diff.stderr);
		return diff.stdout.split(directory.replaceAll("\\", "/")).join("source");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
export function issueBody(source, revision, hash, diff, previous = "") {
	const history = [
		...new Set(
			[...previous.matchAll(/<!-- upstream-content:([a-f0-9]{64}) -->/g)]
				.map((match) => match[1])
				.concat(hash),
		),
	];
	const fence = "`".repeat(
		Math.max(
			3,
			...[...diff.matchAll(/`+/g)].map((match) => match[0].length + 1),
		),
	);
	return [
		`<!-- upstream-source:${source.key} -->`,
		...history.map((value) => `<!-- upstream-content:${value} -->`),
		`The upstream file used by ${source.files.map((file) => `\`${file}\``).join(", ")} changed.`,
		`Reviewed source: ${source.url}`,
		`Candidate revision: https://github.com/${source.repo}/commit/${revision}`,
		"Review the actual source changes, preserve applicable notices, and attribute local adaptations with SPDX snippets. Then update the source comment to the reviewed commit. Closing this review records this candidate as reviewed; it will not be reopened automatically.",
		`${fence}diff\n${diff.slice(0, 18000)}\n${fence}${diff.length > 18000 ? "\nThe workflow artifact contains the complete diff." : ""}`,
	].join("\n\n");
}
