// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { publicationFor } from "./lib/package-release.mjs";

export async function stageRelease(
	config,
	directory,
	tag,
	manifest,
	{ published, stage },
) {
	const release = publicationFor(config, directory, tag, manifest);
	if (await published(release)) return { ...release, status: "published" };
	await stage(release);
	return { ...release, status: "staged" };
}

export function stagingSummary(release) {
	const heading = `${release.name}@${release.version}`;
	return release.status === "published"
		? `## ${heading} is already published

No package was uploaded.
`
		: `## ${heading} is awaiting npm approval

[Review staged packages on npm](https://www.npmjs.com/settings/hyecompany/staged-packages) and approve this version with 2FA. It is not publicly available yet.

After approval, [run Documentation](https://github.com/hyecompany/vem-web/actions/workflows/docs.yml) on main with **deploy** checked. Deployment verifies that both packages match their published releases; otherwise the existing site stays in place.
`;
}

async function main() {
	const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
	const directory = process.env.VEM_PUBLISH_PACKAGE;
	if (!Object.hasOwn(config.packages, directory ?? ""))
		throw Error("VEM_PUBLISH_PACKAGE must name one configured package.");
	const manifest = JSON.parse(
		readFileSync(`${directory}/package.json`, "utf8"),
	);
	const release = await stageRelease(
		config,
		directory,
		process.env.VEM_RELEASE_TAG,
		manifest,
		{
			async published({ name, version }) {
				const response = await fetch(
					`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
				);
				if (response.status === 404) return false;
				if (!response.ok)
					throw Error(`Could not verify npm version: ${response.status}`);
				const existing = await response.json();
				if (existing.name !== name || existing.version !== version)
					throw Error("npm returned an unexpected package version.");
				return true;
			},
			stage({ directory }) {
				execFileSync(
					"npm",
					[
						"stage",
						"publish",
						resolve(directory),
						"--provenance",
						"--access",
						"public",
					],
					{ stdio: "inherit" },
				);
			},
		},
	);
	const summary = stagingSummary(release);
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	await main();
