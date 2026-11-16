// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { digest, repository, sourceDiff, sources } from "./lib/ui-upstream.mjs";

import { prepareUpdate } from "./lib/ui-upstream-merge.mjs";
import { publishReview } from "./lib/ui-upstream-review.mjs";

const publish = process.argv.includes("--reviews");
const target = process.env.GITHUB_REPOSITORY;
if (
	publish &&
	(!process.env.GITHUB_TOKEN ||
		!target ||
		process.env.GITHUB_REF !== `refs/heads/${process.env.DEFAULT_BRANCH}`)
)
	throw Error("Review updates require the trusted default-branch workflow");
async function github(path, init = {}, allowMissing = false) {
	const response = await fetch(`https://api.github.com/repos/${path}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
			...(process.env.GITHUB_TOKEN
				? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
				: {}),
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (allowMissing && response.status === 404) return null;
	if (!response.ok) throw Error(`GitHub ${response.status}: ${path}`);
	return response.json();
}
async function content(source, revision, allowMissing = false) {
	const response = await fetch(
		`https://raw.githubusercontent.com/${source.repo}/${revision}/${source.path}`,
		{ signal: AbortSignal.timeout(30_000) },
	);
	if (response.status === 404 && allowMissing) return null;
	if (!response.ok)
		throw Error(
			`Source ${response.status}: ${source.repo}/${revision}/${source.path}`,
		);
	return (await response.text()).replaceAll("\r\n", "\n");
}
const tracked = await sources();
if (publish && !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""))
	throw Error("Missing checked-out base revision");
const heads = new Map();
for (const source of tracked) {
	if (!heads.has(source.repo)) {
		const [latest] = await github(`${source.repo}/commits?per_page=1`);
		if (!/^[a-f0-9]{40}$/.test(latest?.sha))
			throw Error(`Missing upstream revision for ${source.repo}`);
		heads.set(source.repo, latest.sha);
	}
}
const issues = [];
if (publish)
	for (let page = 1; ; page++) {
		const batch = await github(
			`${target}/issues?state=all&per_page=100&page=${page}`,
		);
		issues.push(...batch);
		if (batch.length < 100) break;
	}
const output = resolve(repository, ".artifacts/ui-upstream");
await mkdir(output, { recursive: true });
const changes = [];
for (const source of tracked) {
	const revision = heads.get(source.repo);
	const before = await content(source, source.revision);
	const after =
		revision === source.revision
			? before
			: await content(source, revision, true);
	if (before === after) continue;
	const hash = digest(after === null ? "deleted upstream source" : after);
	const diff = await sourceDiff(before, after);
	await writeFile(
		resolve(
			output,
			`${basename(source.path)}-${digest(source.key).slice(0, 10)}.diff`,
		),
		diff,
	);
	const result = await prepareUpdate(source, revision, before, after);
	const review = publish
		? await publishReview({
				github,
				target,
				base: process.env.DEFAULT_BRANCH,
				baseSha: process.env.GITHUB_SHA,
				source,
				revision,
				hash,
				diff,
				result,
				items: issues,
			})
		: { kind: result.reason ? "issue" : "pull-request" };
	changes.push({
		source: source.url,
		revision,
		deleted: after === null,
		files: source.files,
		action: review.kind,
		reason: result.reason,
		url: review.url,
	});
	for (const file of result.files ?? [])
		await writeFile(
			resolve(
				output,
				`${basename(file.path)}-${digest(source.key).slice(0, 10)}.candidate`,
			),
			file.content,
		);
}
await writeFile(
	resolve(output, "report.json"),
	`${JSON.stringify(changes, null, 2)}\n`,
);
console.log(
	`${changes.length} actual upstream source changes. ${publish ? "Review tracking updated." : "Report only; no remote changes."}`,
);
