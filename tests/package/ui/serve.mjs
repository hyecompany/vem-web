// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

export async function serve() {
	const stylesheet = await readFile(
		new URL(import.meta.resolve("@hyecompany/vem-ui/styles.css")),
		"utf8",
	);
	const server = await createServer({
		root: import.meta.dirname,
		configFile: false,
		esbuild: { jsx: "automatic" },
		server: { host: "127.0.0.1", port: 0 },
		plugins: [
			{
				name: "server-render-ui",
				configureServer(vite) {
					vite.middlewares.use(async (request, response, next) => {
						if (request.url === "/vem-ui.css") {
							response.setHeader("Content-Type", "text/css; charset=utf-8");
							response.end(stylesheet);
							return;
						}
						if (request.url !== "/") return next();
						try {
							const { App } = await vite.ssrLoadModule("/app.tsx");
							const template = await readFile(
								new URL("index.html", import.meta.url),
								"utf8",
							);
							const html = await vite.transformIndexHtml(
								"/",
								template
									.replace(
										"</head>",
										'<link rel="stylesheet" href="/vem-ui.css"></head>',
									)
									.replace("<!--ssr-->", renderToString(createElement(App))),
							);
							response.setHeader("Content-Type", "text/html");
							response.end(html);
						} catch (error) {
							next(error);
						}
					});
				},
			},
		],
	});
	await server.listen();
	const address = server.httpServer.address();
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () => server.close(),
	};
}
