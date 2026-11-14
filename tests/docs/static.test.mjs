// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { base, root } from "./support/site.mjs";

const out = resolve(root, "packages/docs/out");
async function files(dir) {
	return (
		await Promise.all(
			(
				await readdir(dir, { withFileTypes: true })
			).map((entry) =>
				entry.isDirectory()
					? files(resolve(dir, entry.name))
					: [resolve(dir, entry.name)],
			),
		)
	).flat();
}
test("exported internal links and anchors resolve beneath the deployment base", async () => {
	const html = (await files(out)).filter((file) => file.endsWith(".html"));
	const errors = [];
	const cache = new Map();
	async function document(path) {
		if (!cache.has(path)) cache.set(path, await readFile(path, "utf8"));
		return cache.get(path);
	}
	for (const file of html) {
		const content = await document(file);
		for (const match of content.matchAll(/href="([^"<>]+)"/g)) {
			const href = match[1].replaceAll("&amp;", "&");
			if (/^(https?:|mailto:|data:)/.test(href)) continue;
			const url = new URL(
				href,
				`http://docs${base}/${file
					.slice(out.length + 1)
					.replaceAll("\\", "/")
					.replace(/index\.html$/, "")}`,
			);
			if (
				base &&
				!url.pathname.startsWith(`${base}/`) &&
				url.pathname !== base
			) {
				errors.push(`${file}: outside base ${href}`);
				continue;
			}
			let target = resolve(
				out,
				`.${decodeURIComponent(url.pathname.slice(base.length))}`,
			);
			try {
				if ((await stat(target)).isDirectory())
					target = resolve(target, "index.html");
				await stat(target);
				if (url.hash && target.endsWith(".html")) {
					const id = decodeURIComponent(url.hash.slice(1));
					const text = await document(target);
					if (!text.includes(`id="${id}"`))
						errors.push(`${file}: missing anchor ${href}`);
				}
			} catch {
				errors.push(`${file}: missing target ${href}`);
			}
		}
	}
	assert.deepEqual(
		[...new Set(errors)].slice(0, 20),
		[],
		`${errors.length} broken static links or anchors`,
	);
});
test("text exports contain executable excerpts and equivalent visual explanations", async () => {
	const text = await readFile(resolve(out, "llms-full.txt"), "utf8");
	assert.doesNotMatch(
		text,
		/<(?:Example|Flow|Lab|TaskBoardDemo|UiPreview|ComponentPreview|ComponentCatalog|UiReference)\b/,
	);
	assert.match(text, /function NotesEditor/);
	assert.match(text, /function ProjectButton/);
	assert.match(text, /Preview: A long project name/);
	assert.match(text, /Preview: Loading feedback/);
	assert.match(text, /Three responsibilities/);
	assert.match(text, /Experiment: Keep your own draft/);
	assert.match(text, /Experiment: One plan for several views/);
	assert.match(text, /Experiment: Different fields, different guarantees/);
	const pages = JSON.parse(await readFile(resolve(out, "docs.json"), "utf8"));
	assert.ok(pages.some((page) => page.slug === "data/connect/access"));
	assert.doesNotMatch(text, /Complete source:/);
	assert.ok(pages.filter((page) => page.kind === "api").length > 100);
	const source = await readFile(
		resolve(root, "packages/data/examples/task-board/contract.ts"),
		"utf8",
	);
	const region = source
		.split("// #region contract\n")[1]
		.split("// #endregion contract")[0]
		.trim();
	assert.ok(text.includes(region), "displayed contract is compiled source");
});
test("all public entry points and their exported symbols appear in generated reference", async () => {
	const api = JSON.parse(
		await readFile(resolve(root, "packages/docs/.generated/api.json"), "utf8"),
	);
	const manifest = JSON.parse(
		await readFile(resolve(root, "packages/data/package.json"), "utf8"),
	);
	const entries = Object.keys(manifest.exports).map((entry) =>
		entry === "." ? "index" : entry.slice(2),
	);
	assert.deepEqual(
		api.children.map((entry) => entry.name).sort(),
		entries.sort(),
	);
	for (const entry of api.children) {
		const path = entry.name === "index" ? "index-1" : entry.name;
		const text = await readFile(
			resolve(root, `packages/docs/.generated/api/${path}.md`),
			"utf8",
		);
		for (const member of entry.children ?? [])
			assert.ok(
				text.includes(`[${member.name}]`),
				`${entry.name}.${member.name} missing from reference`,
			);
	}
});

test("every public UI component and binding has a guide and generated reference", async () => {
	for (const file of await files(resolve(root, "packages/docs/components"))) {
		if (!file.endsWith(".tsx")) continue;
		assert.doesNotMatch(
			await readFile(file, "utf8"),
			/from ["'][^"']*(?:@\/components\/ui\/|\/ui\/(?:src|registry)\/)/,
			`Internal UI import in ${file}`,
		);
	}

	const api = JSON.parse(
		await readFile(
			resolve(root, "packages/docs/.generated/ui-api.json"),
			"utf8",
		),
	);
	const manifest = JSON.parse(
		await readFile(resolve(root, "packages/ui/package.json"), "utf8"),
	);
	const entries = Object.keys(manifest.exports)
		.filter((key) => !key.endsWith(".css"))
		.map((key) => (key === "." ? "index" : key.slice(2)));
	assert.deepEqual(
		api.children.map((entry) => entry.name).sort(),
		entries.sort(),
	);
	const catalog = JSON.parse(
		await readFile(
			resolve(root, "packages/docs/content/ui-components.json"),
			"utf8",
		),
	);
	const documented = catalog.flatMap((entry) => entry.exports).sort();
	const actual = api.children
		.flatMap((entry) =>
			entry.children
				.filter((member) => member.kind === 64 || member.kind === 32)
				.map((member) => member.name),
		)
		.sort();
	assert.deepEqual(
		documented,
		actual,
		"the catalog covers every public component and hook",
	);
	const generated = await files(
		resolve(root, "packages/docs/.generated/ui-api"),
	);
	for (const entry of api.children) {
		const module = await readFile(
			resolve(
				root,
				`packages/docs/.generated/ui-api/${entry.name === "index" ? "index-1" : entry.name}.md`,
			),
			"utf8",
		);
		for (const member of entry.children) {
			assert.ok(
				module.includes(`[${member.name}]`),
				`${entry.name}.${member.name} missing from entry reference`,
			);
			assert.ok(
				generated.some((file) => file.endsWith(`.${member.name}.md`)),
				`${member.name} missing generated declaration`,
			);
		}
	}
	const pages = JSON.parse(await readFile(resolve(out, "docs.json"), "utf8"));
	for (const component of catalog) {
		const guide = pages.find((page) => `/docs/${page.slug}` === component.url);
		assert.ok(guide, `${component.title} missing guide`);
		assert.match(guide.text, /@hyecompany\/vem-ui|API reference/);
	}
	assert.ok(pages.some((page) => page.slug === "task-board"));
	assert.doesNotMatch(
		pages.find((page) => page.slug === "").text,
		/Working with data/,
	);
	assert.match(
		pages.find((page) => page.slug === "ui").text,
		/@hyecompany\/vem-ui\/styles.css/,
	);
	assert.doesNotMatch(
		pages
			.filter((page) => page.slug.startsWith("ui"))
			.map((page) => page.text)
			.join("\n"),
		/npx shadcn|RegistryExample|RegistryExports/,
	);
});

test("generic UI examples do not prescribe a React framework boundary", async () => {
	for (const file of await files(resolve(root, "packages/ui/examples"))) {
		if (!file.endsWith(".tsx")) continue;
		const text = await readFile(file, "utf8");
		assert.doesNotMatch(
			text,
			/["']use client["']|from ["']next(?:\/|["'])/,
			file,
		);
	}
});
