// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";

const validationInfrastructure = new Set([
	".github/workflows/checks.yml",
	".github/workflows/publish.yml",
	".github/workflows/docs.yml",
	"scripts/validate.mjs",
	"docs/scripts/finalize-export.mjs",
	"scripts/lib/affected-validation.mjs",
	"tests/github/affected-validation.test.mjs",
]);
const docsScripts = new Set([
	"scripts/generate-docs.mjs",
	"scripts/generate-reference.mjs",
	"scripts/documented-packages.mjs",
	"scripts/component-docs.mjs",
]);

/** Select whole suites; unknown dependencies deliberately widen validation. */
export function selectValidation(paths) {
	if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
		return {
			targets: ["all"],
			reasons: [
				"The changed-file set is unavailable; running full validation.",
			],
		};
	}
	const files = [
		...new Set(
			paths.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, "")),
		),
	].sort();
	if (!files.length)
		return {
			targets: ["check"],
			reasons: ["No changed files were found; running the source check."],
		};
	const selections = new Map();
	function add(target, path, reason) {
		const entries = selections.get(target) ?? [];
		entries.push(`${path}: ${reason}`);
		selections.set(target, entries);
	}
	for (const path of files) {
		if (
			validationInfrastructure.has(path) ||
			/^scripts\/(?:lib\/)?validation[^/]*\.mjs$/.test(path) ||
			path === "docs/scripts/check-packed-next.mjs" ||
			path.startsWith("tests/docs/packed/") ||
			path.startsWith("tests/docs/support/")
		) {
			add("all", path, "shared validation or consumer infrastructure changed");
		} else if (
			path === "REUSE.toml" ||
			path.startsWith("LICENSES/") ||
			/(?:^|\/)(?:LICENSES?|LICENCES?|NOTICE)(?:[.-]|$)/.test(path)
		) {
			add("all", path, "licensing can affect distributed artifacts");
		} else if (
			/(?:^|\/)README\.md$/.test(path) ||
			["CONTRIBUTING.md", "AGENTS.md"].includes(path)
		) {
			add("check", path, "repository guidance changed");
		} else if (
			/^packages\/(?:data|ui)\/tests\/react\//.test(path) ||
			path === "vitest.config.mjs" ||
			path === "tests/support/react.mjs"
		) {
			add(
				"react:validate",
				path,
				"React contracts or their test environment changed",
			);
		} else if (
			path.startsWith("docs/") ||
			/^packages\/(?:data|ui)\/docs\//.test(path) ||
			path.startsWith("tests/docs/") ||
			docsScripts.has(path)
		) {
			add(
				"docs:validate",
				path,
				"documentation or its generated inputs changed",
			);
		} else if (
			path.startsWith(".github/") ||
			path.startsWith("tests/github/")
		) {
			add("workflows", path, "workflow behavior changed");
		} else {
			add(
				"all",
				path,
				"package, configuration, or an unclassified input changed",
			);
		}
	}
	if (selections.has("all"))
		return { targets: ["all"], reasons: selections.get("all") };
	const targets = [
		"check",
		"workflows",
		"react:validate",
		"docs:validate",
	].filter((target) => selections.has(target));
	return {
		targets,
		reasons: targets.flatMap((target) => selections.get(target)),
	};
}

/** Include branch commits, both index/worktree states, and new non-ignored files. */
export function changedFiles(base = "origin/main", directory = process.cwd()) {
	try {
		const run = (args, cwd = directory) =>
			execFileSync("git", args, {
				cwd,
				encoding: "utf8",
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		const root = run(["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, "");
		const ancestor = run(["merge-base", "--", "HEAD", base], root).trim();
		const diff = [
			"diff",
			"--no-ext-diff",
			"--no-relative",
			"--no-renames",
			"--name-only",
			"-z",
		];
		const outputs = [
			run([...diff, ancestor, "--"], root),
			run([...diff, "--cached", ancestor, "--"], root),
			run(["ls-files", "--others", "--exclude-standard", "-z"], root),
		];
		return [
			...new Set(
				outputs.flatMap((output) => output.split("\0").filter(Boolean)),
			),
		].sort();
	} catch {
		return null;
	}
}
