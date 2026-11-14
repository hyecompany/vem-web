// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	SidebarMenuBranch,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@hyecompany/vem-ui";

export function PlanLinks() {
	return (
		<SidebarMenuItem>
			<SidebarMenuBranch
				label="Plans"
				trigger={
					<SidebarMenuButton
						role="link"
						isActive
						render={
							<a href="#plans" aria-current="page">
								<span>Plans</span>
							</a>
						}
					/>
				}
			>
				<SidebarMenuSub>
					<SidebarMenuSubItem>
						<SidebarMenuSubButton render={<a href="#walk">Weekend walk</a>} />
					</SidebarMenuSubItem>
					<SidebarMenuSubItem>
						<SidebarMenuSubButton render={<a href="#picnic">Picnic</a>} />
					</SidebarMenuSubItem>
				</SidebarMenuSub>
			</SidebarMenuBranch>
		</SidebarMenuItem>
	);
}
// #endregion example
