// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
export const components = JSON.parse(
	await readFile(resolve(root, "docs/content/ui-components.json"), "utf8"),
);

export async function renderComponentDocs(text) {
	text = text.replace(
		/<ComponentCatalog\s*\/>/g,
		`| Component | Use it for |\n| --- | --- |\n${components.map((item) => `| [${item.title}](${item.url}) | ${item.description} |`).join("\n")}`,
	);
	return text;
}
