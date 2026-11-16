// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

/** Compile only the library's own utilities; applications never scan installed source. */
export async function componentStyles(root) {
	const scanner = new Scanner({
		sources: [
			{ base: resolve(root, "src"), pattern: "**/*.{ts,tsx}", negated: false },
		],
	});
	const candidates = scanner.scan();
	const utilityClasses = new Set();
	const source = await readFile(resolve(root, "src/utilities.css"), "utf8");
	const compiler = await compile(source, { base: root, onDependency() {} });
	const compiled = postcss.parse(compiler.build(candidates));
	const global = postcss.root();
	const scoped = postcss.atRule({ name: "layer", params: "vem" });
	const keyframes = new Set();
	compiled.walkAtRules(/keyframes$/, (rule) => keyframes.add(rule.params));
	compiled.walkAtRules((rule) => {
		if (rule.name === "property")
			rule.params = rule.params.replaceAll("--tw-", "--vem-tw-");
		if (/keyframes$/.test(rule.name)) rule.params = `vem-${rule.params}`;
	});
	compiled.walkDecls((declaration) => {
		declaration.prop = declaration.prop.replaceAll("--tw-", "--vem-tw-");
		declaration.value = declaration.value.replaceAll("--tw-", "--vem-tw-");
		if (/^(animation|animation-name|--animate-)/.test(declaration.prop)) {
			for (const name of keyframes) {
				declaration.value = declaration.value.replace(
					new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "g"),
					`vem-${name}`,
				);
			}
		}
	});
	// Conditional selector classes belong to the host unless a utility for them was emitted.
	compiled.walkRules((rule) => {
		for (let parent = rule.parent; parent; parent = parent.parent) {
			if (parent.type === "rule") return;
		}
		selectorParser((selectors) => {
			for (const selector of selectors.nodes) {
				for (const node of selector.nodes) {
					if (node.type === "class" && candidates.includes(node.value))
						utilityClasses.add(node.value);
				}
			}
		}).processSync(rule.selector);
	});
	compiled.walkRules((rule) => {
		if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name))
			return;
		rule.selector = selectorParser((selectors) => {
			selectors.walkClasses((node) => {
				if (/^(dark|light)$/.test(node.value)) return;
				if (/^(group|peer)(\/|$)/.test(node.value))
					utilityClasses.add(node.value);
				if (!utilityClasses.has(node.value)) return;
				node.value = `vem-u-${node.value}`;
			});
		}).processSync(rule.selector);
		if (
			/^\*\s*,\s*::before\s*,\s*::after(?:\s*,\s*::backdrop)?$/.test(
				rule.selector,
			) &&
			rule.parent?.type === "atrule" &&
			rule.parent.name === "supports"
		) {
			rule.selector =
				":where([data-vem-ui]), :where([data-vem-ui])::before, :where([data-vem-ui])::after, :where([data-vem-ui])::backdrop";
		}
	});
	for (const node of [...compiled.nodes]) {
		node.remove();
		if (
			node.type === "atrule" &&
			(node.name === "property" || /keyframes$/.test(node.name))
		)
			global.append(node);
		else if (node.type === "comment") global.append(node);
		else if (!(node.type === "atrule" && node.name === "layer" && !node.nodes))
			scoped.append(node);
	}
	const names = (await readdir(resolve(root, "src/styles")))
		.filter((name) => name.endsWith(".css"))
		.sort();
	const styles = await Promise.all(
		names.map((name) => readFile(resolve(root, "src/styles", name), "utf8")),
	);
	const owned = await readFile(resolve(root, "src/styles.css"), "utf8");
	return {
		utilityClasses: [...utilityClasses].sort(),
		css: [
			"@layer theme, vem;",
			...styles,
			global.toString(),
			scoped.toString(),
			owned,
		].join("\n"),
	};
}
