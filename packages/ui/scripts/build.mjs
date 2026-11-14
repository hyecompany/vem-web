// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { componentStyles } from "./styles.mjs";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
if (output !== resolve(import.meta.dirname, "../dist"))
	throw Error("Invalid build directory");
await rm(output, { recursive: true, force: true });
const result = spawnSync(
	process.execPath,
	[require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"],
	{ cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(output, { recursive: true });
const styles = await componentStyles(root);
await writeFile(resolve(output, "styles.css"), styles.css);
await writeFile(
	resolve(output, "internal/utility-classes.js"),
	`// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>\n// SPDX-License-Identifier: Apache-2.0\nexport const utilityClasses = new Set(${JSON.stringify(styles.utilityClasses)});\n`,
);

await copyFile(
	resolve(root, "src/styles.d.ts"),
	resolve(output, "styles.d.ts"),
);

await copyFile(
	resolve(root, "src/devtools/styles.css"),
	resolve(output, "devtools/styles.css"),
);
await copyFile(
	resolve(root, "src/devtools/styles.d.ts"),
	resolve(output, "devtools/styles.d.ts"),
);
