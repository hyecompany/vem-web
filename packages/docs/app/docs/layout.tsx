// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import "@fontsource/poppins/600.css";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from "fumadocs-ui/layouts/docs/slots/sidebar";
import Image from "next/image";
import type { ReactNode } from "react";
import { Appearance } from "@/components/Appearance";
import { DocsSidebar } from "@/components/DocsSidebar";
import { source } from "@/lib/source";
export default function RootDocsLayout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.pageTree}
			themeSwitch={{ enabled: false }}
			sidebar={{ footer: <Appearance /> }}
			slots={{
				sidebar: {
					root: DocsSidebar,
					provider: SidebarProvider,
					trigger: SidebarTrigger,
					useSidebar,
				},
			}}
			nav={{
				title: (
					<span className="inline-flex items-start">
						<Image
							src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/branding/hye.webp`}
							alt="Hye"
							width={1838}
							height={961}
							unoptimized
							loading="eager"
							className="h-6 w-auto"
						/>
						<span className="ml-1.5 flex">
							<span
								className="block -translate-y-[1.5px] text-[22px] leading-none font-semibold"
								style={{ fontFamily: "Poppins, sans-serif" }}
							>
								Vem
							</span>
						</span>
					</span>
				),
				url: "/",
			}}
			links={[
				{ text: "Data", url: "/docs/data" },
				{ text: "UI", url: "/docs/ui" },
				{ text: "Task board", url: "/docs/task-board" },
				{
					text: "GitHub",
					url: "https://github.com/hyecompany/vem-web",
					external: true,
				},
			]}
		>
			{children}
		</DocsLayout>
	);
}
