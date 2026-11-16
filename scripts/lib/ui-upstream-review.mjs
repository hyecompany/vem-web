// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { basename } from "node:path";
import { chooseIssue, digest, issueBody } from "./ui-upstream.mjs";

export function reviewedCandidate(items, source, hash) {
	return items.find(
		(item) =>
			item.body?.includes(`<!-- upstream-source:${source.key} -->`) &&
			item.body.includes(`<!-- upstream-content:${hash} -->`),
	);
}

export async function publishReview({
	github,
	target,
	base,
	baseSha,
	source,
	revision,
	hash,
	diff,
	result,
	items,
}) {
	if (reviewedCandidate(items, source, hash)) return { kind: "unchanged" };
	if (result.reason) {
		const action = chooseIssue(items, source, hash);
		const body = `${issueBody(source, revision, hash, diff, action.issue?.body)}\n\nAutomatic merge stopped: ${result.reason}`;
		const issue = await github(
			action.kind === "update"
				? `${target}/issues/${action.issue.number}`
				: `${target}/issues`,
			{
				method: action.kind === "update" ? "PATCH" : "POST",
				body: JSON.stringify({
					title: `Review upstream ${basename(source.path)} changes`,
					body,
				}),
			},
		);
		items.push(issue);
		return { kind: "issue", url: issue.html_url };
	}
	const branch = `upstream/ui/${digest(source.key).slice(0, 12)}-${hash.slice(0, 16)}`;
	const parent = await github(`${target}/git/commits/${baseSha}`);
	const tree = await github(`${target}/git/trees`, {
		method: "POST",
		body: JSON.stringify({
			base_tree: parent.tree.sha,
			tree: result.files.map(({ path, content }) => ({
				path,
				content,
				mode: "100644",
				type: "blob",
			})),
		}),
	});
	const ref = await github(`${target}/git/ref/heads/${branch}`, {}, true);
	let head = ref?.object.sha;
	if (head) {
		const existing = await github(`${target}/git/commits/${head}`);
		if (
			existing.tree.sha !== tree.sha ||
			existing.parents.length !== 1 ||
			existing.parents[0].sha !== baseSha
		)
			throw Error(
				`Existing candidate branch ${branch} differs from the prepared update; inspect it rather than overwrite it.`,
			);
	} else {
		const commit = await github(`${target}/git/commits`, {
			method: "POST",
			body: JSON.stringify({
				message: `chore(ui): update upstream ${basename(source.path)}`,
				tree: tree.sha,
				parents: [baseSha],
			}),
		});
		head = commit.sha;
		await github(`${target}/git/refs`, {
			method: "POST",
			body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: head }),
		});
	}
	const body = [
		issueBody(source, revision, hash, diff),
		"The three-way merge preserves local modification snippets and license notices. This draft is a candidate, not a claim of behavioral compatibility. Review the diff and run the package, browser, and documentation checks before merging. No release or auto-merge is enabled.",
		"GitHub may require approval for checks initiated by its workflow token. Review and approve those runs from the pull request. Any required DCO sign-off must come from a human contributor.",
		`<!-- upstream-generated-head:${head} -->`,
	].join("\n\n");
	const pr = await github(`${target}/pulls`, {
		method: "POST",
		body: JSON.stringify({
			title: `chore(ui): update upstream ${basename(source.path)}`,
			head: branch,
			base,
			body,
			draft: true,
		}),
	});
	items.push({ ...pr, pull_request: { url: pr.url } });
	return { kind: "pull-request", url: pr.html_url };
}
