// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	useSidebar,
} from "./sidebar.js";
import { SidebarMenuBranch } from "./sidebar-menu-branch.js";

/** A destination supplied by the application, including its native or router link. */
export interface SidebarNavigationLink {
	/** Stable identity, independent of the visible label. */
	key: string;
	label: string;
	icon?: ReactNode;
	/** A native anchor or router link element. SidebarNavigation supplies its visible label. */
	render: ReactElement;
	/** The application decides which destination matches its current route. */
	isActive?: boolean;
}

/** A top-level destination with optional child destinations. */
export interface SidebarNavigationItem extends SidebarNavigationLink {
	children?: readonly SidebarNavigationLink[];
}

export interface SidebarNavigationProps extends ComponentProps<"nav"> {
	items: readonly SidebarNavigationItem[];
	/** Optional destination for compact-mode flyouts within a scoped theme. */
	container?: ComponentProps<typeof SidebarMenuBranch>["container"];
}

/** Composes sidebar links, branch disclosures, compact flyouts, and mobile dismissal. */
export function SidebarNavigation({
	items,
	container,
	...props
}: SidebarNavigationProps) {
	const { isMobile, setOpenMobile } = useSidebar();
	const closeMobile = () => {
		if (isMobile) setOpenMobile(false);
	};
	return (
		<nav {...props}>
			<SidebarMenu>
				{items.map((item) => {
					const branch = !!item.children?.length;
					const trigger = (
						<SidebarMenuButton
							role="link"
							isActive={item.isActive}
							aria-current={item.isActive ? "page" : undefined}
							tooltip={branch ? undefined : item.label}
							render={item.render}
							onClick={closeMobile}
						>
							{item.icon}
							<span>{item.label}</span>
						</SidebarMenuButton>
					);
					return (
						<SidebarMenuItem key={item.key}>
							{branch ? (
								<SidebarMenuBranch
									label={item.label}
									trigger={trigger}
									container={container}
								>
									<SidebarMenuSub>
										{item.children?.map((child) => (
											<SidebarMenuSubItem key={child.key}>
												<SidebarMenuSubButton
													isActive={child.isActive}
													aria-current={child.isActive ? "page" : undefined}
													render={child.render}
													onClick={closeMobile}
												>
													{child.icon}
													<span>{child.label}</span>
												</SidebarMenuSubButton>
											</SidebarMenuSubItem>
										))}
									</SidebarMenuSub>
								</SidebarMenuBranch>
							) : (
								trigger
							)}
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</nav>
	);
}
