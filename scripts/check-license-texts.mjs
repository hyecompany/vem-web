// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "vem-license-texts-"));
try {
	for (const file of await readdir(join(root, "LICENSES"))) {
		if (!file.endsWith(".txt") || file.startsWith("LicenseRef-")) continue;
		const license = file.slice(0, -4);
		const downloaded = join(temporary, file);
		execFileSync("reuse", ["download", license, "--output", downloaded], {
			cwd: root,
			stdio: "inherit",
			windowsHide: true,
		});
		const normalize = (text) => text.replaceAll("\r\n", "\n");
		assert.equal(
			normalize(await readFile(join(root, "LICENSES", file), "utf8")),
			normalize(await readFile(downloaded, "utf8")),
			`${file} must be the unmodified SPDX text downloaded by REUSE`,
		);
		const copies =
			license === "Apache-2.0"
				? ["LICENSE", "packages/data/LICENSE", "packages/ui/LICENSE"]
				: [];
		for (const copy of copies)
			assert.equal(
				normalize(await readFile(join(root, copy), "utf8")),
				normalize(await readFile(downloaded, "utf8")),
				`${copy} must match the canonical SPDX license text`,
			);
	}
} finally {
	await rm(temporary, { recursive: true, force: true });
}
console.log("Standard license texts match fresh REUSE downloads.");
