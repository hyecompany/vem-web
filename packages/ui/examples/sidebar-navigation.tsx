// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { SidebarNavigation } from "@hyecompany/vem-ui";

export function BoardNavigation() {
	return (
		<SidebarNavigation
			aria-label="Board"
			items={[
				{
					key: "plans",
					label: "Plans",
					render: <a href="#plans">Plans</a>,
					children: [
						{
							key: "walk",
							label: "Weekend walk",
							render: <a href="#walk">Weekend walk</a>,
						},
						{
							key: "picnic",
							label: "Picnic",
							render: <a href="#picnic">Picnic</a>,
						},
					],
				},
				{
					key: "completed",
					label: "Completed",
					render: <a href="#completed">Completed</a>,
				},
			]}
		/>
	);
}
// #endregion example
