// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
export const root = resolve(import.meta.dirname, "../../..");
const deployment = JSON.parse(
	await readFile(
		resolve(root, "packages/docs/out/deployment.json"),
		"utf8",
	).catch(() => '{"basePath":""}'),
);
export const base = (process.env.BASE_PATH ?? deployment.basePath).replace(
	/\/$/,
	"",
);
export async function serve({ directory, basePath = base } = {}) {
	const base = basePath;
	const out = directory ?? resolve(root, "packages/docs/out");
	const server = createServer(async (req, res) => {
		try {
			let path = decodeURIComponent(
				new URL(req.url, "http://localhost").pathname,
			);
			if (base && !path.startsWith(`${base}/`) && path !== base) {
				res.writeHead(404);
				res.end();
				return;
			}
			path = path.slice(base.length);
			let file = resolve(out, `.${path}`);
			if (file !== out && !file.startsWith(out + sep))
				throw Error("Outside static output");
			if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
			const types = {
				".html": "text/html",
				".js": "text/javascript",
				".css": "text/css",
				".json": "application/json",
				".txt": "text/plain",
				".tsx": "text/plain",
				".ts": "text/plain",
			};
			res.writeHead(200, {
				"Content-Type": types[extname(file)] ?? "application/octet-stream",
			});
			res.end(await readFile(file));
		} catch {
			res.writeHead(404);
			res.end("Not found");
		}
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return {
		url: `http://127.0.0.1:${server.address().port}${base}`,
		async close() {
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
		},
	};
}
