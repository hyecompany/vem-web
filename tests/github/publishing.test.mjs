// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { publicationFor } from "../../scripts/lib/package-release.mjs";
import { stageRelease, stagingSummary } from "../../scripts/stage-packages.mjs";

const config = JSON.parse(
	await readFile(
		new URL("../../release-please-config.json", import.meta.url),
		"utf8",
	),
);

test("each release targets only its configured package and matching tag", () => {
	for (const [directory, entry] of Object.entries(config.packages)) {
		const manifest = { name: entry["package-name"], version: "1.2.3" };
		assert.deepEqual(
			publicationFor(config, directory, `${entry.component}-v1.2.3`, manifest),
			{ directory, ...manifest },
		);
		assert.throws(() =>
			publicationFor(config, directory, "vem-other-v1.2.3", manifest),
		);
		assert.throws(() =>
			publicationFor(config, directory, `${entry.component}-v1.2.2`, manifest),
		);
		assert.throws(() =>
			publicationFor(config, directory, `${entry.component}-v1.2.3`, {
				...manifest,
				private: true,
			}),
		);
	}
	assert.throws(() =>
		publicationFor(config, "docs", "vem-docs-v1.2.3", {
			name: "@hyecompany/vem-docs",
			version: "1.2.3",
		}),
	);
	assert.throws(() => publicationFor(config, "../package", "tag", {}));
});

test("publication receives the package and tag through environment variables", async () => {
	const workflow = await readFile(
		new URL("../../.github/workflows/publish.yml", import.meta.url),
		"utf8",
	);
	assert.match(workflow, /VEM_PUBLISH_PACKAGE: \$\{\{ inputs.package \}\}/);
	assert.match(workflow, /VEM_RELEASE_TAG: \$\{\{ inputs.tag \}\}/);
	assert.doesNotMatch(workflow, /run:.*\$\{\{/);
	const release = await readFile(
		new URL("../../.github/workflows/release-please.yml", import.meta.url),
		"utf8",
	);
	for (const directory of Object.keys(config.packages))
		assert.ok(
			release.includes(`package: ${directory}`),
			`Missing release job for ${directory}`,
		);
});

test("upstream review writes run only from trusted scheduled or manual source checks", async () => {
	const workflow = await readFile(
		new URL("../../.github/workflows/ui-upstream.yml", import.meta.url),
		"utf8",
	);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /schedule:/);
	assert.doesNotMatch(workflow, /pull_request[:_]/);
	assert.match(
		workflow,
		/github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/,
	);
	assert.match(workflow, /issues: write/);
	assert.match(workflow, /contents: write/);
	assert.match(workflow, /pull-requests: write/);
	assert.match(workflow, /check-ui-upstream.mjs --reviews/);
	assert.doesNotMatch(workflow, /npm publish|run:.*\$\{\{/);
});

test("browser prerequisites are installed before workspace and documentation tests", async () => {
	for (const file of ["checks.yml", "publish.yml", "docs.yml"]) {
		const workflow = await readFile(
			new URL(`../../.github/workflows/${file}`, import.meta.url),
			"utf8",
		);
		const install = workflow.indexOf("run: npx playwright install --with-deps");
		if (file === "checks.yml") {
			assert.ok(
				workflow.indexOf("run: node scripts/plan-validation.mjs") < install,
			);
			assert.match(workflow, /if: steps\.plan\.outputs\.browsers != ''/);
		}
		const run = workflow.indexOf(
			file === "docs.yml" ? "run: npm run docs:validate" : "run: npm run test:",
		);
		assert.ok(
			install >= 0 && run > install,
			`${file} must install browsers before testing`,
		);
	}
});

test("package checks cover PRs and documentation deploys only verified releases", async () => {
	const workflow = await readFile(
		new URL("../../.github/workflows/docs.yml", import.meta.url),
		"utf8",
	);
	const checks = await readFile(
		new URL("../../.github/workflows/checks.yml", import.meta.url),
		"utf8",
	);
	assert.match(checks, /push:\s+branches: \[main\]/);
	assert.match(checks, /run: npm run test:affected/);
	assert.match(checks, /run: npm run test:all/);
	assert.match(
		checks,
		/name: Upload browser failure diagnostics\s+if: failure\(\)/,
	);
	assert.match(checks, /path: \.artifacts\/browser\//);
	assert.match(checks, /include-hidden-files: true/);
	assert.doesNotMatch(workflow, /\n {2}(push|pull_request):/);
	assert.ok(workflow.includes("inputs.deploy && 'pages-release'"));
	assert.ok(
		workflow.includes("github.event.pull_request.number || github.ref"),
	);
	assert.ok(
		workflow.includes(
			"inputs.deploy != true || needs.release.outputs.ready == 'true'",
		),
	);
	assert.match(workflow, /cancel-in-progress: false/);
	assert.match(
		workflow,
		/deploy:\s+name: Deploy to GitHub Pages\s+if: inputs\.deploy == true && github\.ref == 'refs\/heads\/main'/,
	);
	const publish = await readFile(
		new URL("../../.github/workflows/publish.yml", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(publish, /uses: \.\/\.github\/workflows\/docs\.yml/);
	assert.match(publish, /node \.release-tools\/scripts\/stage-packages\.mjs/);
	assert.match(publish, /ref: \$\{\{ github\.sha \}\}/);
	assert.match(publish, /if: github\.ref == 'refs\/heads\/main'/);
	assert.match(publish, /run: npm run test:all/);
	assert.match(publish, /ref: \$\{\{ inputs\.tag \}\}/);
});

test("staging requires a valid release, never uploads published versions, and preserves failures", async () => {
	const directory = "packages/data";
	const manifest = { name: "@hyecompany/vem-data", version: "2.0.0" };
	let uploads = 0;
	const services = {
		published: async () => false,
		stage: async () => {
			uploads++;
		},
	};
	await assert.rejects(
		stageRelease(config, directory, "wrong", manifest, services),
	);
	assert.equal(uploads, 0);
	const staged = await stageRelease(
		config,
		directory,
		"vem-data-v2.0.0",
		manifest,
		services,
	);
	assert.equal(staged.status, "staged");
	assert.equal(uploads, 1);
	assert.match(stagingSummary(staged), /settings\/hye-dev\/staged-packages/);
	assert.match(stagingSummary(staged), /not publicly available/);
	const published = await stageRelease(
		config,
		directory,
		"vem-data-v2.0.0",
		manifest,
		{ ...services, published: async () => true },
	);
	assert.equal(published.status, "published");
	assert.equal(uploads, 1);
	await assert.rejects(
		stageRelease(config, directory, "vem-data-v2.0.0", manifest, {
			...services,
			stage: async () => {
				throw Error("npm rejected staging");
			},
		}),
		/npm rejected staging/,
	);
});
