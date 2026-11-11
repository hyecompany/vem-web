// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	oxc: { jsx: { runtime: "automatic" } },
	optimizeDeps: {
		include: [
			"react",
			"react-dom/client",
			"@hyecompany/vem-data",
			"@hyecompany/vem-data/react",
			"@hyecompany/vem-data/client",
			"@hyecompany/vem-data/runtime",
			"@hyecompany/vem-data/worker",
		],
	},
	worker: {
		format: "es",
		rollupOptions: { output: { entryFileNames: "assets/task-owner.js" } },
	},
	build: { outDir: ".build", emptyOutDir: true },
});
