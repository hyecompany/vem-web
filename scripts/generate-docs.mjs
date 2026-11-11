// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docs = resolve(root, "packages/docs");
const input = resolve(docs, "content/handbook");
const output = resolve(docs, "content/docs");
const base = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
const diagrams = JSON.parse(
	await readFile(resolve(docs, "content/diagrams.json"), "utf8"),
);
const labs = JSON.parse(
	await readFile(resolve(docs, "content/experiments.json"), "utf8"),
);
export async function files(path) {
	return (
		await Promise.all(
			(
				await readdir(path, { withFileTypes: true })
			).map((entry) =>
				entry.isDirectory()
					? files(resolve(path, entry.name))
					: [resolve(path, entry.name)],
			),
		)
	).flat();
}
function metadata(text) {
	const match = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) throw Error("Missing frontmatter");
	return Object.fromEntries(
		match[1].split("\n").map((line) => {
			const at = line.indexOf(":");
			return [line.slice(0, at), JSON.parse(line.slice(at + 1).trim())];
		}),
	);
}
function body(text) {
	return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}
async function save(path, text) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text);
}
if (output !== resolve(root, "packages/docs/content/docs"))
	throw Error("Unexpected output path");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const pages = [];
for (const file of await files(input)) {
	if (!file.endsWith(".mdx")) continue;
	let text = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
	const meta = metadata(text);
	for (const match of [
		...text.matchAll(
			/<Example file="([\w./-]+)"(?: region="([\w-]+)")?\s*\/>/g,
		),
	]) {
		const source = resolve(root, "packages/data/examples", match[1]);
		if (!source.startsWith(resolve(root, "packages/data/examples") + sep))
			throw Error("Example escaped source directory");
		const complete = (await readFile(source, "utf8")).replaceAll("\r\n", "\n");
		let code = complete;
		if (match[2]) {
			const region = complete
				.split(`// #region ${match[2]}\n`)[1]
				?.split(`// #endregion ${match[2]}\n`)[0];
			if (!region) throw Error(`Missing region ${match[1]}:${match[2]}`);
			code = region;
		}
		const lines = code.replace(/^.*#(?:end)?region.*\n/gm, "").split("\n");
		const indent = Math.min(
			...lines
				.filter((line) => line.trim())
				.map((line) => line.match(/^\s*/)[0].length),
		);
		code = lines
			.map((line) => line.slice(indent))
			.join("\n")
			.trim();
		text = text.replace(
			match[0],
			`\n\`\`\`${match[1].endsWith("tsx") ? "tsx" : "ts"}\n${code}\n\`\`\`\n`,
		);
	}
	const path = relative(input, file).replaceAll("\\", "/");
	const slug = path.replace(/(?:\/index)?\.mdx$/, "").replace(/^index$/, "");
	await save(resolve(output, path), text);
	const plain = body(text)
		.replace(
			/<TaskBoardDemo\s*\/>/g,
			"### Explore the task board\n\nThree short interactions teach filtering, completing a task, and editing notes. Filtering and an overview share known task data. A command previews completion until its response is known. An edit keeps its draft when a teammate changes the saved note. Each lesson runs the real Vem runtime with a simulated in-page service. Source reads are simulated calls, not HTTP. The application has no SharedWorker or browser persistence.",
		)
		.replace(/<Flow name="([\w-]+)"\s*\/>/g, (_, name) => {
			const diagram = diagrams[name];
			if (!diagram) throw Error(`Unknown diagram ${name}`);
			return `### ${diagram.title}\n\n${diagram.nodes.map((node, i) => `${i + 1}. ${node.summary}`).join("\n")}\n\n${diagram.explanation}`;
		})
		.replace(/<Lab name="([\w-]+)"\s*\/>/g, (_, name) => {
			const lab = labs[name];
			if (!lab) throw Error(`Unknown experiment ${name}`);
			return `### Experiment: ${lab.title}\n\n${lab.prompt}\n\n${lab.explanation}\n\nRuns a deterministic simulated source with the real Vem runtime. Interactive controls are available in the HTML page; no JavaScript is needed to read this explanation.`;
		});
	pages.push({
		slug,
		title: meta.title,
		description: meta.description,
		order: meta.order ?? 50,
		text: plain,
		kind: "guide",
	});
}
const apiDir = resolve(docs, ".generated/api");
for (const file of await files(apiDir)) {
	if (!file.endsWith(".md")) continue;
	const name = relative(apiDir, file).replaceAll("\\", "/");
	const original = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
	const title =
		original
			.match(/^# (.+)$/m)?.[1]
			?.replaceAll("`", "")
			.replace(/\\([<>_])/g, "$1") ?? name.slice(0, -3);
	const text = original
		.replace(/^# .+\n/m, "")
		.replace(
			/\]\(([^)]+)\.md(#[^)]*)?\)/g,
			(_, path, anchor = "") =>
				`](/docs/data/reference/api${path === "index" ? "" : `/${path}`}${anchor})`,
		);
	const slug = `data/reference/api${name === "index.md" ? "" : `/${name.slice(0, -3)}`}`;
	const description =
		"Generated from the public package entry points. Types and signatures follow the installed source.";
	await save(
		resolve(output, `${slug}${name === "index.md" ? "/index" : ""}.mdx`),
		`---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n${text}`,
	);
	pages.push({ slug, title, description, text, kind: "api", order: 100 });
}
const folders = new Set([
	"",
	...pages.flatMap((page) => {
		const parts = page.slug.split("/");
		return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
	}),
]);
for (const folder of folders) {
	const prefix = folder ? `${folder}/` : "";
	const children = pages
		.filter(
			(page) =>
				page.slug.startsWith(prefix) &&
				!page.slug.slice(prefix.length).includes("/"),
		)
		.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
	const nested = [...folders]
		.filter(
			(value) =>
				value.startsWith(prefix) &&
				value !== folder &&
				!value.slice(prefix.length).includes("/"),
		)
		.sort((a, b) => {
			const weight = (name) =>
				pages.find((page) => page.slug === name)?.order ??
				pages.find((page) => page.slug === `${name}/index`)?.order ??
				50;
			return weight(a) - weight(b);
		});
	const index = pages.find(
		(page) => page.slug === folder || page.slug === `${folder}/index`,
	);
	const items = [
		...children.map((page) => page.slug.slice(prefix.length) || "index"),
		...nested.map((value) => value.slice(prefix.length)),
	];
	await save(
		resolve(output, folder, "meta.json"),
		JSON.stringify(
			{
				title:
					index?.title ??
					(folder.endsWith("/api")
						? "API signatures"
						: folder.split("/").at(-1) || "Hye Vem"),
				pages: [...new Set(items)],
			},
			null,
			2,
		),
	);
}
const exampleOutput = resolve(docs, "public/examples");
if (exampleOutput !== resolve(root, "packages/docs/public/examples"))
	throw Error("Unexpected example output path");
await rm(exampleOutput, { recursive: true, force: true });
await cp(
	resolve(root, "packages/data/examples"),
	resolve(docs, "public/examples"),
	{
		recursive: true,
		filter: (source) =>
			!source
				.split(sep)
				.some((part) => [".build", "node_modules"].includes(part)),
	},
);
const origin = "https://hyevem.com";
function readingOrder(page) {
	const segments = page.slug.split("/");
	return segments.map(
		(_, index) =>
			pages.find(
				(candidate) =>
					candidate.slug === segments.slice(0, index + 1).join("/"),
			)?.order ?? 50,
	);
}
const ordered = [...pages]
	.sort((a, b) => {
		const kind = Number(a.kind === "api") - Number(b.kind === "api");
		if (kind) return kind;
		const left = readingOrder(a),
			right = readingOrder(b);
		for (let index = 0; index < Math.max(left.length, right.length); index++) {
			const difference = (left[index] ?? -1) - (right[index] ?? -1);
			if (difference) return difference;
		}
		return a.slug.localeCompare(b.slug);
	})
	.map((page) => ({
		...page,
		text: page.text.replace(
			/\]\(\/(docs|examples)([^)]*)\)/g,
			(_, area, path) => `](${origin}/${area}${path})`,
		),
	}));
const listing = ordered
	.map(
		(page) =>
			`- [${page.title}](${origin}/docs/${page.slug}): ${page.description}`,
	)
	.join("\n");
await save(
	resolve(docs, "public/llms.txt"),
	`# Hye Vem\n\nVem Data is an independently consumable browser/React knowledge runtime. These documents describe the current source, not a release promise.\n\n${listing}\n\nFull text: ${origin}/llms-full.txt\n`,
);
await save(
	resolve(docs, "public/llms-full.txt"),
	ordered
		.map(
			(page) =>
				`# ${page.title}\n\n${page.description}\n\nURL: ${origin}/docs/${page.slug}\n\n${page.text}`,
		)
		.join("\n\n---\n\n"),
);
await save(
	resolve(docs, "public/docs.json"),
	JSON.stringify(
		ordered.map((page) => ({ ...page, url: `${base}/docs/${page.slug}` })),
	),
);
console.log(
	`Prepared ${pages.filter((page) => page.kind === "guide").length} guides and ${pages.filter((page) => page.kind === "api").length} API pages, examples, navigation, and text exports.`,
);

await save(
	resolve(docs, "public/deployment.json"),
	JSON.stringify({ basePath: base }),
);
