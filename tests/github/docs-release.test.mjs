// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { documentationRelease } from "../../scripts/docs-release.mjs";

const packages = ["data", "ui"].map((id) => ({
	directory: `packages/${id}`,
	component: `vem-${id}`,
	name: `@hyecompany/vem-${id}`,
	version: "1.0.0",
}));

test("each independently released package must be published and match the checkout", async () => {
	const published = async () => true;
	const tree = async (_ref, directory) => directory;
	assert.deepEqual(await documentationRelease(packages, { published, tree }), {
		ready: true,
		waiting: [],
	});
	const unpublished = await documentationRelease(packages, {
		published: async (name) => name.endsWith("data"),
		tree,
	});
	assert.equal(unpublished.ready, false);
	assert.deepEqual(unpublished.waiting, [
		"@hyecompany/vem-ui@1.0.0 is not the current published release",
	]);
	for (const changed of packages) {
		const result = await documentationRelease(packages, {
			published,
			tree: async (ref, directory) =>
				ref === "HEAD" && directory === changed.directory
					? "unreleased changes"
					: directory,
		});
		assert.equal(result.ready, false);
		assert.equal(result.waiting.length, 1);
	}
});

test("a missing release tag or registry failure never authorizes deployment", async () => {
	assert.equal(
		(
			await documentationRelease(packages, {
				published: async () => true,
				tree: async () => undefined,
			})
		).ready,
		false,
	);
	await assert.rejects(
		documentationRelease(packages, {
			published: async () => {
				throw Error("registry unavailable");
			},
			tree: async () => "tree",
		}),
		/registry unavailable/,
	);
});
