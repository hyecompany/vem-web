// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Application } from "typedoc";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
	await readFile(resolve(root, "packages/data/package.json"), "utf8"),
);
const entries = Object.keys(manifest.exports).map((key) =>
	resolve(
		root,
		`packages/data/src/${key === "." ? "index" : key.slice(2)}${key === "./react" ? ".tsx" : ".ts"}`,
	).replaceAll("\\", "/"),
);
const app = await Application.bootstrapWithPlugins({
	name: "Vem Data API",
	entryPoints: entries,
	tsconfig: resolve(root, "packages/data/tsconfig.json"),
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
	intentionallyNotExported: [
		"ReadModelSnapshot",
		"Listener",
		"ScopeArgument",
		"ContractTypes",
		"Field",
		"BoundCommands",
		"BoundEditors",
		"BoundDescriptor",
	],
	validation: { invalidLink: true, notExported: true },
});
const project = await app.convert();
if (!project)
	throw new Error("TypeDoc could not convert the public entry points.");
app.validate(project);
await mkdir(resolve(root, "packages/docs/.generated"), { recursive: true });
app.options.setValue("outputs", [
	{ name: "markdown", path: resolve(root, "packages/docs/.generated/api") },
]);
await app.generateOutputs(project);
await app.generateJson(
	project,
	resolve(root, "packages/docs/.generated/api.json"),
);
await writeFile(
	resolve(root, "packages/docs/.generated/entries.json"),
	JSON.stringify(Object.keys(manifest.exports)),
);
if (app.logger.hasErrors()) throw new Error("TypeDoc reported errors.");
