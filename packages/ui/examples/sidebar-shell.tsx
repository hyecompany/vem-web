// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Sidebar,
	SidebarContent,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@hyecompany/vem-ui";
import type { ReactNode } from "react";

export function AppShell({
	navigation,
	children,
}: {
	navigation: ReactNode;
	children: ReactNode;
}) {
	return (
		<SidebarProvider>
			<Sidebar>
				<SidebarHeader>Weekend</SidebarHeader>
				<SidebarContent>{navigation}</SidebarContent>
			</Sidebar>
			<SidebarInset>
				<header>
					<SidebarTrigger aria-label="Toggle navigation" />
				</header>
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
// #endregion example
