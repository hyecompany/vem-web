// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Application } from "typedoc";
import { documentedPackages } from "./documented-packages.mjs";

const root = resolve(import.meta.dirname, "..");
const generated = resolve(root, "packages/docs/.generated");
await mkdir(generated, { recursive: true });

for (const { id, title, reference } of documentedPackages) {
	const directory = resolve(root, "packages", id);
	const manifest = JSON.parse(
		await readFile(resolve(directory, "package.json"), "utf8"),
	);
	const exports = Object.entries(manifest.exports).filter(
		([key]) => !key.endsWith(".css"),
	);
	const entries = [];
	for (const [key, value] of exports) {
		const target =
			typeof value === "string" ? value : (value.import ?? value.default);
		if (typeof target !== "string")
			throw Error(`Missing JavaScript export: ${manifest.name}/${key}`);
		const stem = resolve(
			directory,
			target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ""),
		);
		let source = `${stem}.ts`;
		try {
			await access(source);
		} catch {
			source = `${stem}.tsx`;
			await access(source);
		}
		entries.push(source.replaceAll("\\", "/"));
	}
	const app = await Application.bootstrapWithPlugins({
		name: `${title} API`,
		entryPoints: entries,
		tsconfig: resolve(directory, "tsconfig.json"),
		plugin: ["typedoc-plugin-markdown"],
		readme: "none",
		excludePrivate: true,
		excludeProtected: true,
		excludeInternal: true,
		disableSources: true,
		entryFileName: "index",
		router: "member",
		flattenOutputFiles: true,
		hideBreadcrumbs: true,
		useHTMLAnchors: true,
		intentionallyNotExported:
			id === "data"
				? [
						"ReadModelSnapshot",
						"Listener",
						"ScopeArgument",
						"ContractTypes",
						"Field",
						"BoundCommands",
						"BoundEditors",
						"BoundDescriptor",
					]
				: [],
		validation: { invalidLink: true, notExported: true },
	});
	const project = await app.convert();
	if (!project) throw Error(`TypeDoc could not convert ${manifest.name}.`);
	app.validate(project);
	const referenceOutput = resolve(generated, reference);
	if (
		!referenceOutput.startsWith(`${generated}/`) &&
		!referenceOutput.startsWith(`${generated}\\`)
	)
		throw Error("Reference escaped generated output");
	await rm(referenceOutput, { recursive: true, force: true });
	app.options.setValue("outputs", [
		{ name: "markdown", path: resolve(generated, reference) },
	]);
	await app.generateOutputs(project);
	await app.generateJson(project, resolve(generated, `${reference}.json`));
	await writeFile(
		resolve(generated, id === "data" ? "entries.json" : `${id}-entries.json`),
		JSON.stringify(exports.map(([key]) => key)),
	);
	if (app.logger.hasErrors())
		throw Error(`TypeDoc reported errors in ${manifest.name}.`);
}
