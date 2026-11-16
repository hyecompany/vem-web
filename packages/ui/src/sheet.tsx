// SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
// SPDX-License-Identifier: MIT
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/bases/base/ui/sheet.tsx
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/styles/style-nova.css
// Reviewed upstream template and Nova styling; local adaptations are marked below.

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
"use client";
// SPDX-SnippetEnd

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import type * as React from "react";
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Button } from "./button.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { cn } from "./internal/cn.js";

// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function Sheet({ ...props }: SheetPrimitive.Root.Props) {
	return <SheetPrimitive.Root data-vem-ui="" data-slot="sheet" {...props} />;
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
	return (
		<SheetPrimitive.Trigger
			data-vem-ui=""
			data-slot="sheet-trigger"
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
	return (
		<SheetPrimitive.Close data-vem-ui="" data-slot="sheet-close" {...props} />
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
	return (
		<SheetPrimitive.Portal data-vem-ui="" data-slot="sheet-portal" {...props} />
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetOverlay({
	className,
	...props
}: Omit<SheetPrimitive.Backdrop.Props, "className"> & { className?: string }) {
	return (
		<SheetPrimitive.Backdrop
			data-vem-ui=""
			data-slot="sheet-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
				className,
			)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetContent({
	container,
	className,
	children,
	side = "right",
	showCloseButton = true,
	...props
}: Omit<SheetPrimitive.Popup.Props, "className"> & { className?: string } & {
	container?: SheetPrimitive.Portal.Props["container"];
	side?: "top" | "right" | "bottom" | "left";
	showCloseButton?: boolean;
}) {
	return (
		<SheetPortal container={container}>
			<SheetOverlay />
			<SheetPrimitive.Popup
				data-vem-ui=""
				data-slot="sheet-content"
				data-side={side}
				className={cn(
					"fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-10 data-[side=bottom]:data-starting-style:translate-y-10 data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:-translate-x-10 data-[side=left]:data-starting-style:-translate-x-10 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-10 data-[side=right]:data-starting-style:translate-x-10 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:-translate-y-10 data-[side=top]:data-starting-style:-translate-y-10 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<SheetPrimitive.Close
						data-vem-ui=""
						data-slot="sheet-close"
						render={
							<Button
								data-vem-ui=""
								variant="ghost"
								className={cn(
									"absolute top-3 right-3 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
								)}
								size="icon-sm"
							/>
						}
					>
						<IconX />
						<span data-vem-ui="" className={cn("sr-only")}>
							Close
						</span>
					</SheetPrimitive.Close>
				)}
			</SheetPrimitive.Popup>
		</SheetPortal>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sheet-header"
			className={cn("flex flex-col gap-0.5 p-4", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sheet-footer"
			className={cn("mt-auto flex flex-col gap-2 p-4", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetTitle({
	className,
	...props
}: Omit<SheetPrimitive.Title.Props, "className"> & { className?: string }) {
	return (
		<SheetPrimitive.Title
			data-vem-ui=""
			data-slot="sheet-title"
			className={cn(
				"font-heading text-base font-medium text-foreground",
				className,
			)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SheetDescription({
	className,
	...props
}: Omit<SheetPrimitive.Description.Props, "className"> & {
	className?: string;
}) {
	return (
		<SheetPrimitive.Description
			data-vem-ui=""
			data-slot="sheet-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

export {
	Sheet,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};
