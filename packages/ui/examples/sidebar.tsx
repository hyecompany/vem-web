// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarProvider,
} from "@hyecompany/vem-ui";
import type { CSSProperties } from "react";
import { BoardNavigation } from "./sidebar-navigation.js";

export function SidebarExample() {
	return (
		<SidebarProvider
			style={{ minHeight: "16rem", "--sidebar-width": "9rem" } as CSSProperties}
		>
			<Sidebar collapsible="none">
				<SidebarHeader>
					<strong>Weekend</strong>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>My board</SidebarGroupLabel>
						<SidebarGroupContent>
							<BoardNavigation />
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
			<div style={{ padding: "1rem", minWidth: 0, flex: 1 }}>
				<p id="plans">Your plans.</p>
				<p id="walk">Weekend walk.</p>
				<p id="picnic">Picnic.</p>
				<p id="completed">Completed tasks.</p>
			</div>
		</SidebarProvider>
	);
}
// #endregion example
