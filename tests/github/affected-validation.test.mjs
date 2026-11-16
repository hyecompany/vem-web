// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	changedFiles,
	selectValidation,
} from "../../scripts/lib/affected-validation.mjs";

test("guides and their generated inputs select docs while ordinary guidance stays cheap", () => {
	for (const path of [
		"packages/data/docs/start/index.mdx",
		"packages/ui/docs/components/button.mdx",
		"docs/content/diagrams.json",
		"docs/components/Flow.tsx",
		"scripts/generate-reference.mjs",
		"tests/docs/static.test.mjs",
	]) {
		const selected = selectValidation([path]);
		assert.deepEqual(selected.targets, ["docs:validate"]);
		assert.ok(selected.reasons[0].startsWith(`${path}:`));
	}
	for (const path of [
		"packages/data/tests/react/provider.test.tsx",
		"packages/ui/tests/react/query-status.test.tsx",
		"vitest.config.mjs",
		"tests/support/react.mjs",
	]) {
		assert.deepEqual(selectValidation([path]).targets, ["react:validate"]);
		assert.deepEqual(selectValidation([path, "package-lock.json"]).targets, [
			"all",
		]);
	}
	assert.deepEqual(
		selectValidation(["README.md", "packages/ui/README.md"]).targets,
		["check"],
	);
	assert.deepEqual(
		selectValidation([
			".github/workflows/dco.yml",
			"tests/github/publishing.test.mjs",
		]).targets,
		["workflows"],
	);
	assert.deepEqual(
		selectValidation([
			"README.md",
			"docs\\app\\layout.tsx",
			"./.github/dependabot.yml",
			"README.md",
		]).targets,
		["check", "workflows", "docs:validate"],
	);
});

test("package changes and unknown or shared dependencies cannot silently skip validation", () => {
	for (const input of [
		null,
		undefined,
		[42],
		["new-area/handler.ts"],
		["package-lock.json"],
		["package.json"],
		["biome.json"],
		["packages/data/src/runtime.ts"],
		["packages/ui/tests/server.test.mjs"],
		["packages/ui/examples/button.tsx"],
		["scripts/validate.mjs"],
		["scripts/lib/affected-validation.mjs"],
		["tests/github/affected-validation.test.mjs"],
		[".github/workflows/checks.yml"],
		[".github/workflows/publish.yml"],
		[".github/workflows/docs.yml"],
		["docs/scripts/check-packed-next.mjs"],
		["docs/scripts/finalize-export.mjs"],
		["tests/docs/support/site.mjs"],
		["tests/docs/packed/app/page.tsx"],
		["REUSE.toml"],
		["packages/ui/LICENSE-MIT"],
		["docs/public/LICENSE-shadcn.txt"],
		["docs/public/LICENSES.txt"],
		["LICENSES/MIT.txt"],
	]) {
		const selected = selectValidation(input);
		assert.deepEqual(selected.targets, ["all"], JSON.stringify(input));
		assert.ok(selected.reasons.length > 0);
	}
	assert.deepEqual(
		selectValidation(["README.md", "packages/data/src/runtime.ts"]).targets,
		["all"],
	);
	assert.deepEqual(selectValidation([]).targets, ["check"]);
});

test("Git changes include branch commits, staged and unstaged work, deleted and renamed paths, and new files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "vem-affected-validation-"));
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: directory,
			encoding: "utf8",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	try {
		git("init", "--initial-branch=main");
		git("config", "user.name", "Fixture");
		git("config", "user.email", "fixture@example.invalid");
		git("config", "commit.gpgsign", "false");
		await mkdir(join(directory, "hooks"));
		git("config", "core.hooksPath", join(directory, "hooks"));
		await writeFile(join(directory, ".gitignore"), "ignored/\nhooks/\n");
		for (const name of [
			"staged.ts",
			"unstaged.ts",
			"deleted.ts",
			"old-name.mdx",
			"canceled.ts",
		])
			await writeFile(join(directory, name), "original\n");
		git("add", ".");
		git("commit", "-m", "fixture");
		git("update-ref", "refs/remotes/origin/main", "HEAD");
		await writeFile(join(directory, "committed.ts"), "branch change\n");
		git("add", "committed.ts");
		git("commit", "-m", "fixture change");
		await writeFile(join(directory, "staged.ts"), "staged\n");
		await writeFile(
			join(directory, "canceled.ts"),
			"staged but later restored in worktree\n",
		);
		git("add", "staged.ts", "canceled.ts");
		await writeFile(join(directory, "canceled.ts"), "original\n");
		await writeFile(join(directory, "unstaged.ts"), "unstaged\n");
		await rm(join(directory, "deleted.ts"));
		git("mv", "old-name.mdx", "new-name.mdx");
		await writeFile(join(directory, "new guide.mdx"), "untracked\n");
		await mkdir(join(directory, "ignored"));
		await writeFile(join(directory, "ignored", "artifact.js"), "ignored\n");
		assert.deepEqual(changedFiles("origin/main", directory), [
			"canceled.ts",
			"committed.ts",
			"deleted.ts",
			"new guide.mdx",
			"new-name.mdx",
			"old-name.mdx",
			"staged.ts",
			"unstaged.ts",
		]);
		assert.equal(changedFiles("missing-reference", directory), null);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
