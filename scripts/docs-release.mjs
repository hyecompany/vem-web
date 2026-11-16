// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Only a checkout matching every published package can replace the public site. */
export async function documentationRelease(packages, { published, tree }) {
	const waiting = [];
	for (const { directory, component, name, version } of packages) {
		const tag = `${component}-v${version}`;
		if (!(await published(name, version))) {
			waiting.push(`${name}@${version} is not the current published release`);
			continue;
		}
		const released = await tree(`refs/tags/${tag}`, directory);
		if (!released || released !== (await tree("HEAD", directory))) {
			waiting.push(`${directory} differs from ${tag}`);
		}
	}
	return { ready: waiting.length === 0, waiting };
}

async function main() {
	const root = resolve(import.meta.dirname, "..");
	const config = JSON.parse(
		await readFile(resolve(root, "release-please-config.json"), "utf8"),
	);
	const packages = await Promise.all(
		Object.entries(config.packages).map(async ([directory, entry]) => {
			const manifest = JSON.parse(
				await readFile(resolve(root, directory, "package.json"), "utf8"),
			);
			return {
				directory,
				component: entry.component,
				name: manifest.name,
				version: manifest.version,
			};
		}),
	);
	const result = await documentationRelease(packages, {
		async published(name, version) {
			const response = await fetch(
				`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
			);
			if (response.status === 404) return false;
			if (!response.ok)
				throw Error(`npm verification failed for ${name}: ${response.status}`);
			const manifest = await response.json();
			return manifest.name === name && manifest.version === version;
		},
		async tree(ref, directory) {
			try {
				return execFileSync(
					"git",
					["rev-parse", "--verify", `${ref}:${directory}`],
					{
						cwd: root,
						encoding: "utf8",
						windowsHide: true,
						stdio: ["ignore", "pipe", "pipe"],
					},
				).trim();
			} catch (error) {
				if (ref === "HEAD") throw error;
				return undefined;
			}
		},
	});
	if (process.env.GITHUB_OUTPUT)
		await appendFile(process.env.GITHUB_OUTPUT, `ready=${result.ready}\n`);
	console.log(
		result.ready
			? "Documentation matches published releases."
			: `Keeping the existing public site:\n${result.waiting.join("\n")}`,
	);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	await main();
