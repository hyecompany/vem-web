// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
	chooseIssue,
	fileSources,
	issueBody,
	parseSource,
	sourceDiff,
	sources,
	validateSnippets,
} from "../../scripts/lib/ui-upstream.mjs";

import {
	mergeSource,
	prepareUpdate,
} from "../../scripts/lib/ui-upstream-merge.mjs";
import {
	publishReview,
	reviewedCandidate,
} from "../../scripts/lib/ui-upstream-review.mjs";

const url = `https://github.com/shadcn-ui/ui/blob/${"a".repeat(40)}/apps/v4/registry/bases/base/ui/button.tsx`;
// REUSE-IgnoreStart
const notices = `// SPDX-FileCopyrightText: 2023 shadcn
// SPDX-License-Identifier: MIT
// Source: ${url}
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: 2026 Example Contributor
// SPDX-License-Identifier: Apache-2.0
import { cn } from "./utils.js";
// SPDX-SnippetEnd`;
// REUSE-IgnoreEnd

test("actual UI sources have pinned URLs and attributed local adaptations", async () => {
	await sources();
});
test("source comments refer directly to immutable files without a registry manifest", () => {
	const [source] = fileSources(notices, "button.tsx");
	assert.equal(source.repo, "shadcn-ui/ui");
	assert.throws(() =>
		fileSources(notices.replace(`// Source: ${url}\n`, ""), "button.tsx"),
	);
	assert.equal(source.path, "apps/v4/registry/bases/base/ui/button.tsx");
	for (const invalid of [
		url.replace("a".repeat(40), "main"),
		url.replace("github.com", "example.com"),
		`${url}?raw=1`,
	])
		assert.throws(() => parseSource(invalid));
});
// REUSE-IgnoreStart
test("modification snippets require closed boundaries and author attribution", () => {
	validateSnippets(notices, "button.tsx");
	assert.throws(() =>
		fileSources(
			notices.replace("SPDX-SnippetBegin", "not a snippet"),
			"button.tsx",
		),
	);
	assert.throws(() =>
		validateSnippets(notices.replace("SPDX-SnippetEnd", ""), "button.tsx"),
	);
	assert.throws(() =>
		validateSnippets(
			notices.replace(
				"SPDX-SnippetCopyrightText: 2026 Example Contributor",
				"SPDX-SnippetCopyrightText:",
			),
			"button.tsx",
		),
	);
});
// REUSE-IgnoreEnd
test("source diffs compare implementation text and include removals", async () => {
	const diff = await sourceDiff(
		"export const value = 1;\n",
		"export const value = 2;\n",
	);
	assert.match(diff, /-export const value = 1/);
	assert.match(diff, /\+export const value = 2/);
	assert.match(
		await sourceDiff("deleted implementation\n", null),
		/-deleted implementation/,
	);
});
test("a reviewed candidate stays closed and new content updates one open issue", () => {
	const source = { ...parseSource(url), files: ["packages/ui/src/button.tsx"] },
		hash = "b".repeat(64),
		next = "c".repeat(64),
		revision = "d".repeat(40);
	const issue = {
		number: 1,
		state: "closed",
		body: issueBody(source, revision, hash, "diff"),
	};
	assert.equal(chooseIssue([issue], source, hash).kind, "unchanged");
	assert.equal(chooseIssue([issue], source, next).kind, "create");
	assert.equal(
		chooseIssue([{ ...issue, state: "open" }], source, next).kind,
		"update",
	);
	const updated = issueBody(source, revision, next, "diff", issue.body);
	assert.equal(
		chooseIssue([{ ...issue, body: updated }], source, hash).kind,
		"unchanged",
	);
	assert.equal(
		chooseIssue([{ ...issue, body: updated }], source, next).kind,
		"unchanged",
	);
});

test("clean source merges retain local adaptations; conflicts and attribution changes need review", async () => {
	const base = "const first = 1;\n\nconst second = 2;\n\nconst third = 3;\n";
	const after = base.replace("first = 1", "first = 4");
	const local = `${base}\n${notices}\n`;
	const merged = await mergeSource(local, base, after);
	assert.equal(merged.content, local.replace("first = 1", "first = 4"));
	assert.match(
		(await mergeSource(local.replace("first = 1", "first = 5"), base, after))
			.reason,
		/overlap/,
	);
	assert.match(
		(
			await mergeSource(
				notices,
				notices,
				notices.replace("./utils.js", "./new.js"),
			)
		).reason,
		/attributed/,
	);
	const source = { ...parseSource(url), files: ["packages/ui/src/button.tsx"] };
	const update = await prepareUpdate(
		source,
		"b".repeat(40),
		base,
		after,
		async () => local,
	);
	assert.equal(update.files.length, 1);
	assert.match(update.files[0].content, new RegExp("b".repeat(40)));
	assert.match(
		(await prepareUpdate(source, "b".repeat(40), base, null)).reason,
		/removed/,
	);
	assert.match(
		(
			await prepareUpdate(
				{ ...source, path: "style-nova.css" },
				"b".repeat(40),
				base,
				after,
			)
		).reason,
		/different file format/,
	);
});

test("review preparation is all-or-nothing when one consumer conflicts", async () => {
	const source = { ...parseSource(url), files: ["a.tsx", "b.tsx"] };
	const base = "const first = 1;\n\nconst second = 2;\n\nconst third = 3;\n";
	const result = await prepareUpdate(
		source,
		"b".repeat(40),
		base,
		base.replace("first = 1", "first = 4"),
		async (file) =>
			`${file === "b.tsx" ? base.replace("first = 1", "first = 5") : base}\n${notices}\n`,
	);
	assert.equal(result.files, undefined);
	assert.match(result.reason, /b.tsx/);
});

test("clean candidates create draft PRs from the checked-out base and preserve reviewed candidates", async () => {
	const source = { ...parseSource(url), files: ["packages/ui/src/button.tsx"] };
	const calls = [];
	const items = [];
	const args = {
		target: "example/repo",
		base: "main",
		baseSha: "base-sha",
		source,
		revision: "b".repeat(40),
		hash: "c".repeat(64),
		diff: "diff",
		items,
		result: { files: [{ path: source.files[0], content: "candidate" }] },
	};
	const github = async (path, init = {}, allowMissing = false) => {
		const body = init.body ? JSON.parse(init.body) : undefined;
		calls.push({ path, method: init.method, body, allowMissing });
		if (path.includes("/git/ref/")) return null;
		if (path.endsWith("/git/commits/base-sha"))
			return { tree: { sha: "base-tree" } };
		if (path.endsWith("/git/trees")) return { sha: "new-tree" };
		if (path.endsWith("/git/commits")) return { sha: "new-head" };
		if (path.endsWith("/git/refs")) return {};
		if (path.endsWith("/pulls"))
			return { ...body, html_url: "pr-url", url: "api-url", state: "open" };
		throw Error(path);
	};
	assert.equal((await publishReview({ ...args, github })).kind, "pull-request");
	const pr = calls.find((call) => call.path.endsWith("/pulls"));
	assert.equal(pr.body.draft, true);
	assert.equal(pr.body.base, "main");
	assert.deepEqual(
		calls.find((call) => call.path.endsWith("/git/commits")).body.parents,
		["base-sha"],
	);
	assert.equal(
		calls.find((call) => call.path.endsWith("/git/trees")).body.base_tree,
		"base-tree",
	);
	assert.equal((await publishReview({ ...args, github })).kind, "unchanged");
	items[0].state = "closed";
	assert.ok(reviewedCandidate(items, source, args.hash));
	assert.equal(calls.filter((call) => call.path.endsWith("/pulls")).length, 1);
	assert.ok(calls.every((call) => call.method !== "PATCH"));
});

test("merge conflicts update issues without creating a branch or pull request", async () => {
	const source = { ...parseSource(url), files: ["packages/ui/src/button.tsx"] };
	const hash = "c".repeat(64);
	const calls = [];
	const github = async (path, init) => {
		const body = JSON.parse(init.body);
		calls.push({ path, ...init });
		return { ...body, number: 42, state: "open" };
	};
	const result = await publishReview({
		github,
		target: "example/repo",
		base: "main",
		baseSha: "base",
		source,
		revision: "b".repeat(40),
		hash,
		diff: "diff",
		items: [
			{
				number: 42,
				state: "open",
				body: issueBody(source, "a".repeat(40), "d".repeat(64), "old diff"),
			},
		],
		result: { reason: "Overlapping edits" },
	});
	assert.equal(result.kind, "issue");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].method, "PATCH");
	assert.match(calls[0].path, /issues\/42$/);
	assert.match(calls[0].body, /Overlapping edits/);
});

test("an interrupted PR creation can resume but an altered candidate branch is never reused", async () => {
	const source = { ...parseSource(url), files: ["packages/ui/src/button.tsx"] };
	for (const changed of [false, true]) {
		const calls = [];
		const github = async (path, init = {}) => {
			calls.push(path);
			if (path.endsWith("/git/commits/base"))
				return { tree: { sha: "base-tree" } };
			if (path.endsWith("/git/trees")) return { sha: "candidate-tree" };
			if (path.includes("/git/ref/heads/"))
				return { object: { sha: "previous-head" } };
			if (path.endsWith("/git/commits/previous-head"))
				return {
					tree: { sha: changed ? "human-changes" : "candidate-tree" },
					parents: [{ sha: "base" }],
				};
			if (path.endsWith("/pulls"))
				return {
					...JSON.parse(init.body),
					url: "pr",
					html_url: "pr",
					state: "open",
				};
			throw Error(`Unexpected write: ${path}`);
		};
		const attempt = publishReview({
			github,
			target: "example/repo",
			base: "main",
			baseSha: "base",
			source,
			revision: "b".repeat(40),
			hash: "c".repeat(64),
			diff: "diff",
			items: [],
			result: { files: [{ path: source.files[0], content: "candidate" }] },
		});
		if (changed) {
			await assert.rejects(attempt, /rather than overwrite/);
			assert.ok(calls.every((path) => !path.endsWith("/pulls")));
		} else assert.equal((await attempt).kind, "pull-request");
		assert.ok(calls.every((path) => !path.endsWith("/git/refs")));
	}
});
