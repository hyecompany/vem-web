// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer as createVite } from "vite";
import { createTaskFixture } from "./fixture.mjs";
export async function startTaskBoard(port = 4310) {
	const fixture = createTaskFixture();
	let vite;
	const server = createServer(async (req, res) => {
		try {
			if (!(await fixture.handle(req, res))) vite.middlewares(req, res);
		} catch (error) {
			console.error(error);
			if (!res.headersSent) res.writeHead(500);
			res.end("Demo request failed");
		}
	});
	vite = await createVite({
		configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
		optimizeDeps: { force: true },
		server: { middlewareMode: true, ws: { server } },
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	return {
		fixture,
		url: `http://127.0.0.1:${server.address().port}`,
		async close() {
			fixture.close();
			await vite.close();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const app = await startTaskBoard(Number(process.env.PORT) || 4310);
	console.log(`Task board: ${app.url}`);
	for (const signal of ["SIGINT", "SIGTERM"])
		process.once(signal, () => void app.close());
}
