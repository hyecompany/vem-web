// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import defaultMdxComponents from "fumadocs-ui/mdx";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { Flow } from "@/components/Flow";
import { Lab, TaskBoardDemo } from "@/components/InteractiveExamples";
import { source } from "@/lib/source";
export default async function Page({
	params,
}: {
	params: Promise<{ slug?: string[] }>;
}) {
	const { slug = [] } = await params;
	const page = source.getPage(slug);
	if (!page) notFound();
	const MDX = page.data.body;
	return (
		<DocsPage toc={page.data.toc}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDX
					components={{
						...defaultMdxComponents,
						Flow,
						Lab,
						TaskBoardDemo,
					}}
				/>
			</DocsBody>
		</DocsPage>
	);
}
export function generateStaticParams() {
	return source.generateParams();
}
export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug?: string[] }>;
}) {
	const { slug = [] } = await params;
	const page = source.getPage(slug);
	if (!page) notFound();
	return { title: page.data.title, description: page.data.description };
}
