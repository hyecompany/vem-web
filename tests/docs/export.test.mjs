// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { normalizeSegments } from "../../packages/docs/scripts/finalize-export.mjs";

test("static segment exports match browser URLs without changing unrelated files", async () => {
	const out = await mkdtemp(resolve(tmpdir(), "vem-docs-export-"));
	try {
		const nested = resolve(out, "docs/ui/__next.docs/$oc$slug");
		await mkdir(nested, { recursive: true });
		await writeFile(resolve(nested, "__PAGE__.txt"), "page segment");
		await writeFile(resolve(out, "docs/ui/__next._tree.txt"), "tree segment");
		await writeFile(resolve(out, "docs/ui/ordinary.txt"), "ordinary");
		assert.equal(await normalizeSegments(out), 1);
		assert.equal(
			await readFile(
				resolve(out, "docs/ui/__next.docs.$oc$slug.__PAGE__.txt"),
				"utf8",
			),
			"page segment",
		);
		assert.equal(
			await readFile(resolve(out, "docs/ui/ordinary.txt"), "utf8"),
			"ordinary",
		);
		assert.equal(await normalizeSegments(out), 0);
		await writeFile(
			resolve(out, "docs/ui/__next.docs.$oc$slug.__PAGE__.txt"),
			"conflict",
		);
		await assert.rejects(normalizeSegments(out), /Conflicting segment export/);
	} finally {
		await rm(out, { recursive: true, force: true });
	}
});
