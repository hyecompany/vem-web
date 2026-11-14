// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { build } from "vite";

async function bundle(source, absentData = false) {
	const result = await build({
		configFile: false,
		logLevel: "silent",
		plugins: [
			{
				name: "consumer-entry",
				resolveId(id) {
					if (
						id === "consumer" ||
						id.replaceAll("\\", "/").endsWith("/consumer")
					)
						return "\0consumer";
					if (absentData && id.startsWith("@hyecompany/vem-data"))
						throw new Error("UI-only consumers must not require Vem Data");
				},
				load(id) {
					if (id === "\0consumer") return source;
				},
			},
		],
		build: {
			write: false,
			minify: true,
			lib: { entry: "consumer", formats: ["es"] },
			rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"] },
		},
	});
	const chunks = (
		Array.isArray(result)
			? result.flatMap((build) => build.output)
			: result.output
	).filter((item) => item.type === "chunk");
	const code = chunks.map((chunk) => chunk.code).join("\n");
	const rendered = chunks.flatMap((chunk) =>
		Object.entries(chunk.modules)
			.filter(([, value]) => value.renderedLength > 0)
			.map(([name]) => name.replaceAll("\\", "/")),
	);
	return {
		code,
		rendered,
		bytes: Buffer.byteLength(code),
		gzip: gzipSync(code).length,
	};
}

test("production consumers exclude unrelated edit, feedback and owner implementations", async (t) => {
	const button = await bundle(
		'export { Button } from "@hyecompany/vem-ui";',
		true,
	);
	const command = await bundle(
		'export { CommandButton } from "@hyecompany/vem-ui/data";',
	);
	const editor = await bundle(
		'export { bindText } from "@hyecompany/vem-ui/data";',
	);
	const search = await bundle(
		'export { useSearch } from "@hyecompany/vem-ui/data";',
	);
	for (const [name, result] of Object.entries({
		button,
		command,
		editor,
		search,
	})) {
		assert.equal(
			result.rendered.some((path) => path.includes("/devtools/")),
			false,
			name,
		);
		assert.doesNotMatch(result.code, /VEM_DEVTOOLS|vem-inspector/);
		t.diagnostic(
			`${name}: ${result.bytes} bytes, ${result.gzip} gzip bytes (React external)`,
		);
		assert.equal(
			result.rendered.some((path) =>
				/(?:dexie|xstate|@tanstack\/db|\/data\/dist\/runtime(?:\/|\.))/.test(
					path,
				),
			),
			false,
			name,
		);
	}
	assert.equal(
		button.rendered.some((path) => path.includes("/data/dist/")),
		false,
	);
	assert.equal(
		command.rendered.some((path) =>
			/\/(?:edit|react-feedback|activity-toasts)\.js$/.test(path),
		),
		false,
	);
	assert.equal(
		editor.rendered.some((path) => path.includes("/data/dist/")),
		false,
	);
	assert.doesNotMatch(editor.code, /useEffect|useState|useSyncExternalStore/);
	assert.equal(
		search.rendered.some((path) =>
			/\/(?:edit|react-feedback|activity-toasts|command-button)\.js$/.test(
				path,
			),
		),
		false,
	);
});

test("inspector styles require their explicit development entry", async () => {
	const ordinary = await readFile(
		new URL("../../dist/styles.css", import.meta.url),
		"utf8",
	);
	const inspector = await readFile(
		new URL("../../dist/devtools/styles.css", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(ordinary, /vem-inspector/);
	assert.match(inspector, /\.vem-inspector/);
});
