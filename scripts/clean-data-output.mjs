// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = await realpath(
	fileURLToPath(new URL("../packages/data", import.meta.url)),
);
const output = join(packageRoot, "dist");
let metadata;
try {
	metadata = await lstat(output);
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
if (metadata) {
	const resolved = await realpath(output);
	if (
		!metadata.isDirectory() ||
		metadata.isSymbolicLink() ||
		dirname(resolved) !== packageRoot ||
		basename(resolved) !== "dist"
	)
		throw new Error(
			`Refusing to clean unexpected output directory ${resolved}`,
		);
	await rm(resolved, { recursive: true, force: true });
}
