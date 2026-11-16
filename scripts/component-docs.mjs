// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
export const components = JSON.parse(
	await readFile(
		resolve(root, "packages/docs/content/ui-components.json"),
		"utf8",
	),
);

export async function renderComponentDocs(text) {
	text = text.replace(
		/<ComponentCatalog\s*\/>/g,
		`| Component | Use it for |\n| --- | --- |\n${components.map((item) => `| [${item.title}](${item.url}) | ${item.description} |`).join("\n")}`,
	);
	const references = [...text.matchAll(/<UiReference name="([\w]+)"\s*\/>/g)];
	if (!references.length) return text;
	const files = await readdir(resolve(root, "packages/docs/.generated/ui-api"));
	function entry(name) {
		return files.find((file) => file.endsWith(`.${name}.md`));
	}
	for (const match of references) {
		const file = entry(match[1]);
		if (!file) throw Error(`Missing public UI reference: ${match[1]}`);
		const props = entry(`${match[1]}Props`);
		const links = [
			`[API reference](/docs/ui/reference/api/${file.slice(0, -3)})`,
		];
		if (props)
			links.push(`[All props](/docs/ui/reference/api/${props.slice(0, -3)})`);
		text = text.replace(match[0], links.join(" · "));
	}
	return text;
}
