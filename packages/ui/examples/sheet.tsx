// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Button,
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@hyecompany/vem-ui";
export function SheetExample() {
	return (
		<Sheet>
			<SheetTrigger render={<Button variant="outline" />}>
				Board details
			</SheetTrigger>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Weekend board</SheetTitle>
					<SheetDescription>
						A shared place for your next small adventure.
					</SheetDescription>
				</SheetHeader>
				<div style={{ padding: "1rem" }}>
					<p>Three tasks are ready to plan.</p>
					<SheetClose render={<Button />}>Done</SheetClose>
				</div>
			</SheetContent>
		</Sheet>
	);
}
// #endregion example
