// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, run } from "@mdx-js/mdx";
import { remarkHeading, remarkStructure } from "fumadocs-core/mdx-plugins";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { VFile } from "vfile";
import { remarkComments } from "../../docs/lib/remark-comments.ts";

test("MDX comments preserve source attribution without entering rendered or searchable content", async () => {
	const source = `{/* copyright <author@example.com> */}

# Example

Before {/* <hidden> */} after. Answer: {1 + 1}.

<strong>Visible JSX</strong>

{ /* empty expression */ }

{/* comment */ 'Real expression'}
`;
	const file = new VFile({
		value: source,
		data: { unstable_runtimeOutputs: true },
	});
	const output = await compile(file, {
		outputFormat: "function-body",
		remarkPlugins: [
			remarkComments,
			() => (_tree, input) => {
				assert.equal(String(input), source);
			},
			remarkHeading,
			[remarkStructure, { exportAs: "structuredData" }],
		],
	});
	const search = JSON.stringify(file.data.structuredData);
	assert.doesNotMatch(search, /author@example|hidden|empty expression/);
	assert.match(search, /Before {2}after/);
	assert.match(search, /Visible JSX/);
	const module = await run(output, runtime);
	const html = renderToStaticMarkup(runtime.jsx(module.default, {}));
	assert.match(html, /Answer: 2/);
	assert.match(html, /<strong>Visible JSX<\/strong>/);
	assert.match(html, /Real expression/);
	assert.doesNotMatch(html, /author@example|hidden|empty expression/);
});
