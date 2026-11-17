// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import type { Nodes, Root } from "mdast";
import type { VFile } from "vfile";

// Fumadocs core 16.19.3 parses comment-only MDX expressions as executable values.
export function remarkComments() {
	return (tree: Root, file: VFile) => {
		function visit(node: Nodes) {
			if (!("children" in node)) return;
			node.children = node.children.filter((child) => {
				if (
					(child.type === "mdxFlowExpression" ||
						child.type === "mdxTextExpression") &&
					child.data?.estree?.body.length === 0
				) {
					replaceSource(file, child, "");
					return false;
				}
				return true;
			}) as typeof node.children;
			node.children.forEach(visit);
		}
		visit(tree);
	};
}
