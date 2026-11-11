import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const workspaces = Array.isArray(root.workspaces) ? root.workspaces : [];

for (const workspace of workspaces) {
	const [parent, pattern] = workspace.split("/");
	if (pattern !== "*") {
		throw new Error(`Unsupported workspace pattern: ${workspace}`);
	}

	for (const name of readdirSync(parent)) {
		const directory = join(parent, name);
		const packageDirectory = join(directory, "package.json");
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(packageDirectory, "utf8"));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (manifest.private) continue;

		const response = await fetch(
			`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
		);
		if (response.ok) {
			console.log(
				`Skipping ${manifest.name}@${manifest.version}; it is already published.`,
			);
			continue;
		}
		if (response.status !== 404) {
			throw new Error(
				`Could not verify ${manifest.name}@${manifest.version} on npm: ${response.status} ${response.statusText}`,
			);
		}

		execFileSync(
			"npm",
			[
				"publish",
				"--workspace",
				directory,
				"--provenance",
				"--access",
				"public",
			],
			{
				stdio: "inherit",
			},
		);
	}
}
