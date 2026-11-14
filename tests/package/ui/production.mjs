// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, preview } from "vite";

const sources = {
	button: `import { Button } from "@hyecompany/vem-ui";
 export function App() { return <Button>Core consumer</Button>; }`,
	command: `import { command } from "@hyecompany/vem-data";
 import { DataProvider } from "@hyecompany/vem-data/react";
 import { CommandButton } from "@hyecompany/vem-ui/data";
 const availability = {state: "blocked", reason: "Local admission fixture"};
 const client = { watchAvailability: () => ({subscribe: () => () => {}, getSnapshot: () => availability}) };
 const operation = command({ resource: "tasks", name: "complete", target: "a", input: {} });
 export function App() { return <DataProvider client={client}><CommandButton command={operation}>Complete task</CommandButton></DataProvider>; }`,
	editor: `import { edit } from "@hyecompany/vem-data";
 import { DataProvider, useEdit } from "@hyecompany/vem-data/react";
 import { Textarea } from "@hyecompany/vem-ui";
 import { bindText } from "@hyecompany/vem-ui/data";
 const description = edit({resource: "tasks", name: "notes", target: "a"});
 const client = {
  subscribe: () => () => {}, access: () => "allowed",
  accessSnapshot: () => ({contextId:"fixture", generation:0, scopes:{public:{state:"allowed",generation:0}}}),
  prepareEdit: async () => ({ descriptor:description, values:{notes:"Packed editor"}, etag:"v1", baseline:{}, fieldDisclosure:{notes:{scope:"public",generation:0}}, writeAccess:"public", contextId:"fixture", accessGeneration:0 }),
 };
 function Editor() { const form = useEdit(description); return <Textarea aria-label="Notes" {...bindText(form.field("notes"))} />; }
 export function App() { return <DataProvider client={client}><Editor /></DataProvider>; }`,
};

// These host stubs isolate consumer payloads; runtime behavior is exercised in the Data integration browser suite.
export async function productionConsumer(kind) {
	const directory = join(import.meta.dirname, `production-${kind}`);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "app.jsx"), sources[kind]);
	await writeFile(
		join(directory, "main.jsx"),
		`import {createRoot} from "react-dom/client"; import {App} from "./app.jsx"; import "@hyecompany/vem-ui/styles.css"; createRoot(document.getElementById("root")).render(<App/>);`,
	);
	await writeFile(
		join(directory, "index.html"),
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packed consumer</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>',
	);
	let chunks = [];
	let styles = [];
	await build({
		root: directory,
		configFile: false,
		logLevel: "silent",
		esbuild: { jsx: "automatic" },
		plugins: [
			{
				name: "inspect-requested-payload",
				generateBundle(_options, bundle) {
					styles = Object.values(bundle)
						.filter(
							(item) => item.type === "asset" && item.fileName.endsWith(".css"),
						)
						.map((item) => ({ fileName: item.fileName, source: item.source }));
					chunks = Object.values(bundle)
						.filter((item) => item.type === "chunk")
						.map((item) => ({
							fileName: item.fileName,
							code: item.code,
							modules: Object.entries(item.modules)
								.filter(([, value]) => value.renderedLength > 0)
								.map(([name]) => name.replaceAll("\\", "/")),
						}));
				},
			},
		],
		build: { minify: true },
	});
	const server = await preview({
		root: directory,
		configFile: false,
		preview: { host: "127.0.0.1", port: 0 },
	});
	return {
		url: server.resolvedUrls.local[0],
		chunks,
		styles,
		close: () => server.close(),
	};
}
