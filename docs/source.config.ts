// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { remarkComments } from "./lib/remark-comments";

export const docs = defineDocs({
	dir: "content/docs",
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: (plugins) => [remarkComments, ...plugins],
		rehypeCodeOptions: {
			themes: {
				light: "github-light-high-contrast",
				dark: "github-dark-high-contrast",
			},
		},
	},
});
