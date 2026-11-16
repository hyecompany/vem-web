// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { publicationFor } from "./lib/package-release.mjs";

const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const directory = process.env.VEM_PUBLISH_PACKAGE;
const tag = process.env.VEM_RELEASE_TAG;
if (!Object.hasOwn(config.packages, directory ?? ""))
	throw Error("VEM_PUBLISH_PACKAGE must name one configured package.");
const manifest = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
const release = publicationFor(config, directory, tag, manifest);
const response = await fetch(
	`https://registry.npmjs.org/${encodeURIComponent(release.name)}/${release.version}`,
);
if (response.ok) {
	console.log(
		`Skipping ${release.name}@${release.version}; it is already published.`,
	);
} else {
	if (response.status !== 404)
		throw Error(
			`Could not verify npm version: ${response.status} ${response.statusText}`,
		);
	execFileSync(
		"npm",
		[
			"publish",
			"--workspace",
			release.directory,
			"--provenance",
			"--access",
			"public",
		],
		{ stdio: "inherit" },
	);
}
