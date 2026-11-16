// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Button,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@hyecompany/vem-ui";

export function TooltipExample() {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger render={<Button variant="outline" />}>
					Save task
				</TooltipTrigger>
				<TooltipContent>Keep the changes to this task.</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
// #endregion example
