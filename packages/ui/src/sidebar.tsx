// SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
// SPDX-License-Identifier: MIT
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/bases/base/ui/sidebar.tsx
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/styles/style-nova.css
// Reviewed upstream template and Nova styling; local adaptations are marked below.

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
"use client";

// SPDX-SnippetEnd

import { Menu } from "@base-ui/react/menu";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { IconLayoutSidebar } from "@tabler/icons-react";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Button } from "./button.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Input } from "./input.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { cn } from "./internal/cn.js";
import { SidebarBranchContext } from "./internal/sidebar-branch-context.js";
import { sidebarPressHandlers } from "./internal/sidebar-press.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { useIsMobile } from "./internal/use-mobile.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Separator } from "./separator.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "./sheet.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Skeleton } from "./skeleton.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

// SPDX-SnippetEnd

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";

export type SidebarContextProps = {
	state: "expanded" | "collapsed";
	open: boolean;
	setOpen: (open: boolean) => void;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	isMobile: boolean;
	toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) {
		throw new Error("useSidebar must be used within a SidebarProvider.");
	}

	return context;
}

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarProvider({
	defaultOpen = true,
	open: openProp,
	onOpenChange: setOpenProp,
	className,
	style,
	children,
	...props
}: React.ComponentProps<"div"> & {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const isMobile = useIsMobile();
	const [openMobile, setOpenMobile] = React.useState(false);

	// This is the internal state of the sidebar.
	// We use openProp and setOpenProp for control from outside the component.
	const [_open, _setOpen] = React.useState(defaultOpen);
	const open = openProp ?? _open;
	const setOpen = React.useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const openState = typeof value === "function" ? value(open) : value;
			if (setOpenProp) {
				setOpenProp(openState);
			} else {
				_setOpen(openState);
			}
		},
		[setOpenProp, open],
	);

	// Helper to toggle the sidebar.
	const toggleSidebar = React.useCallback(() => {
		return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
	}, [isMobile, setOpen]);

	// We add a state so that we can do data-state="expanded" or "collapsed".
	// This makes it easier to style the sidebar with Tailwind classes.
	const state = open ? "expanded" : "collapsed";

	const contextValue = React.useMemo<SidebarContextProps>(
		() => ({
			state,
			open,
			setOpen,
			isMobile,
			openMobile,
			setOpenMobile,
			toggleSidebar,
		}),
		[state, open, setOpen, isMobile, openMobile, toggleSidebar],
	);

	return (
		<SidebarContext.Provider value={contextValue}>
			<div
				data-vem-ui=""
				data-slot="sidebar-wrapper"
				style={
					{
						"--sidebar-width": SIDEBAR_WIDTH,
						"--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
						...style,
					} as React.CSSProperties
				}
				className={cn(
					"group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function Sidebar({
	container,
	side = "left",
	variant = "sidebar",
	collapsible = "offcanvas",
	className,
	children,
	dir,
	...props
}: React.ComponentProps<"div"> & {
	side?: "left" | "right";
	variant?: "sidebar" | "floating" | "inset";
	collapsible?: "offcanvas" | "icon" | "none";
	container?: React.ComponentProps<typeof SheetContent>["container"];
}) {
	const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

	if (collapsible === "none") {
		return (
			<div
				data-vem-ui=""
				data-slot="sidebar"
				dir={dir}
				className={cn(
					"flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		);
	}

	if (isMobile) {
		return (
			<Sheet open={openMobile} onOpenChange={setOpenMobile}>
				<SheetContent
					{...props}
					container={container}
					data-vem-ui=""
					dir={dir}
					data-sidebar="sidebar"
					data-slot="sidebar"
					data-mobile="true"
					className={cn(
						"w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground",
						className,
					)}
					style={
						{
							"--sidebar-width": SIDEBAR_WIDTH_MOBILE,
							width: "var(--sidebar-width)",
							...props.style,
						} as React.CSSProperties
					}
					side={side}
				>
					<SheetHeader data-vem-ui="" className={cn("sr-only")}>
						<SheetTitle>Sidebar</SheetTitle>
						<SheetDescription>Displays the mobile sidebar.</SheetDescription>
					</SheetHeader>
					<div data-vem-ui="" className={cn("flex h-full w-full flex-col")}>
						{children}
					</div>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<div
			data-vem-ui=""
			className={cn("group peer hidden text-sidebar-foreground md:block")}
			data-state={state}
			data-collapsible={state === "collapsed" ? collapsible : ""}
			data-variant={variant}
			data-side={side}
			data-slot="sidebar"
		>
			{/* This is what handles the sidebar gap on desktop */}
			<div
				data-vem-ui=""
				data-slot="sidebar-gap"
				className={cn([
					"relative w-(--sidebar-width) bg-transparent transition-[width] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)]",
					"group-data-[collapsible=offcanvas]:w-0",
					"group-data-[side=right]:rotate-180",
					variant === "floating" || variant === "inset"
						? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
						: "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
				])}
			/>
			<div
				data-vem-ui=""
				data-slot="sidebar-container"
				dir={dir}
				data-side={side}
				className={cn(
					[
						"fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:-left-(--sidebar-width) data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:-right-(--sidebar-width) md:flex",
						// Adjust the padding for floating and inset variants.
						variant === "floating" || variant === "inset"
							? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
							: "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
					],
					className,
				)}
				{...props}
			>
				<div
					data-vem-ui=""
					data-sidebar="sidebar"
					data-slot="sidebar-inner"
					className={cn(
						"flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border",
					)}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarTrigger({
	className,
	onClick,
	...props
}: React.ComponentProps<typeof Button>) {
	const { toggleSidebar } = useSidebar();

	return (
		<Button
			data-vem-ui=""
			data-sidebar="trigger"
			data-slot="sidebar-trigger"
			variant="ghost"
			size="icon-sm"
			className={cn([], className)}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) toggleSidebar();
			}}
			{...props}
		>
			<IconLayoutSidebar />
			<span data-vem-ui="" className={cn("sr-only")}>
				Toggle Sidebar
			</span>
		</Button>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
	const { toggleSidebar } = useSidebar();

	return (
		<button
			data-vem-ui=""
			data-sidebar="rail"
			data-slot="sidebar-rail"
			aria-label="Toggle Sidebar"
			tabIndex={-1}
			onClick={toggleSidebar}
			title="Toggle Sidebar"
			className={cn(
				[
					"absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:inset-s-1/2 after:w-0.5 hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2",
					"in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
					"[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
					"group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
					"[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
					"[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
				],
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
function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
	return (
		<main
			data-vem-ui=""
			data-slot="sidebar-inset"
			className={cn(
				"relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm",
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
function SidebarInput({
	className,
	...props
}: React.ComponentProps<typeof Input>) {
	return (
		<Input
			data-vem-ui=""
			data-slot="sidebar-input"
			data-sidebar="input"
			className={cn("h-8 w-full bg-background shadow-none", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-header"
			data-sidebar="header"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-footer"
			data-sidebar="footer"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarSeparator({
	className,
	...props
}: React.ComponentProps<typeof Separator>) {
	return (
		<Separator
			data-vem-ui=""
			data-slot="sidebar-separator"
			data-sidebar="separator"
			className={cn("mx-2 w-auto bg-sidebar-border", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-content"
			data-sidebar="content"
			className={cn(
				"no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
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
function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-group"
			data-sidebar="group"
			className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarGroupLabel({
	className,
	render,
	...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
					className,
				),
			},
			props,
		),
		render,
		state: {
			"vem-ui": true,
			slot: "sidebar-group-label",
			sidebar: "group-label",
		},
	});
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarGroupAction({
	className,
	render,
	...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
	return useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				type: render ? undefined : "button",
				className: cn(
					"absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
					className,
				),
			},
			props,
		),
		render,
		state: {
			"vem-ui": true,
			slot: "sidebar-group-action",
			sidebar: "group-action",
		},
	});
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarGroupContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-group-content"
			data-sidebar="group-content"
			className={cn("w-full text-sm", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-vem-ui=""
			data-slot="sidebar-menu"
			data-sidebar="menu"
			className={cn(
				"flex w-full min-w-0 flex-col gap-1 transition-[gap] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[collapsible=icon]:gap-2",
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
function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-vem-ui=""
			data-slot="sidebar-menu-item"
			data-sidebar="menu-item"
			className={cn("group/menu-item relative", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
const sidebarMenuButtonVariants = cva(
	"peer/menu-button group/menu-button relative flex w-full min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-lg p-0 text-left text-[15px] font-medium ring-sidebar-ring outline-hidden transition-[width,height,padding,gap] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:gap-0 hover:bg-transparent hover:text-sidebar-foreground focus-visible:ring-2 active:bg-transparent active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-transparent data-open:hover:text-sidebar-accent-foreground data-active:bg-transparent data-active:font-medium data-active:text-sidebar-foreground [&_svg]:size-5 [&_svg]:shrink-0 [&>svg]:mx-2.5 group-data-[collapsible=icon]:[&>svg]:mx-1.5 [&>span:last-child]:truncate group-data-[collapsible=icon]:[&>span:last-child]:opacity-0",
	{
		variants: {
			variant: {
				default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				outline:
					"bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
			},
			size: {
				default: "h-10 text-[15px]",
				sm: "h-7 text-xs",
				lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarMenuButton({
	render,
	isActive = false,
	variant = "default",
	size = "default",
	tooltip,
	className,
	...props
}: useRender.ComponentProps<"button"> &
	React.ComponentProps<"button"> & {
		isActive?: boolean;
		tooltip?: string | React.ComponentProps<typeof TooltipContent>;
	} & VariantProps<typeof sidebarMenuButtonVariants>) {
	const { isMobile, state } = useSidebar();
	const comp = useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				type: render ? undefined : "button",
				className: cn(
					[sidebarMenuButtonVariants({ variant, size }), "vem-sidebar-press"],
					className,
				),
				...sidebarPressHandlers,
			},
			props,
		),
		render: !tooltip ? render : <TooltipTrigger render={render} />,
		state: {
			"vem-ui": true,
			slot: "sidebar-menu-button",
			sidebar: "menu-button",
			size,
			active: isActive,
		},
	});

	if (!tooltip) {
		return comp;
	}

	if (typeof tooltip === "string") {
		tooltip = {
			children: tooltip,
		};
	}

	return (
		<Tooltip>
			{comp}
			<TooltipContent
				side="right"
				align="center"
				hidden={state !== "collapsed" || isMobile}
				{...tooltip}
			/>
		</Tooltip>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarMenuAction({
	className,
	render,
	showOnHover = false,
	...props
}: useRender.ComponentProps<"button"> &
	React.ComponentProps<"button"> & {
		showOnHover?: boolean;
	}) {
	return useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				type: render ? undefined : "button",
				className: cn(
					[
						"absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
						showOnHover &&
							"group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
					],
					className,
				),
			},
			props,
		),
		render,
		state: {
			"vem-ui": true,
			slot: "sidebar-menu-action",
			sidebar: "menu-action",
		},
	});
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarMenuBadge({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-menu-badge"
			data-sidebar="menu-badge"
			className={cn(
				"pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground",
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
function SidebarMenuSkeleton({
	className,
	showIcon = false,
	...props
}: React.ComponentProps<"div"> & {
	showIcon?: boolean;
}) {
	const width = "75%";

	return (
		<div
			data-vem-ui=""
			data-slot="sidebar-menu-skeleton"
			data-sidebar="menu-skeleton"
			className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
			{...props}
		>
			{showIcon && (
				<Skeleton
					data-vem-ui=""
					className={cn("size-4 rounded-md")}
					data-sidebar="menu-skeleton-icon"
				/>
			)}
			<Skeleton
				data-vem-ui=""
				className={cn("h-4 max-w-(--skeleton-width) flex-1")}
				data-sidebar="menu-skeleton-text"
				style={
					{
						"--skeleton-width": width,
					} as React.CSSProperties
				}
			/>
		</div>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
	const flyout = React.useContext(SidebarBranchContext);
	return (
		<ul
			data-vem-ui=""
			data-slot="sidebar-menu-sub"
			role={flyout ? "presentation" : undefined}
			data-sidebar="menu-sub"
			className={cn(
				"mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
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
function SidebarMenuSubItem({
	className,
	...props
}: React.ComponentProps<"li">) {
	const flyout = React.useContext(SidebarBranchContext);
	return (
		<li
			role={flyout ? "presentation" : undefined}
			data-vem-ui=""
			data-slot="sidebar-menu-sub-item"
			data-sidebar="menu-sub-item"
			className={cn("group/menu-sub-item relative", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function SidebarMenuSubButton({
	render,
	size = "md",
	isActive = false,
	className,
	...props
}: useRender.ComponentProps<"a"> &
	React.ComponentProps<"a"> & {
		size?: "sm" | "md";
		isActive?: boolean;
	}) {
	const flyout = React.useContext(SidebarBranchContext);
	const element = useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(
			{
				...sidebarPressHandlers,
				className: cn(
					[
						"vem-sidebar-press",
						"relative isolate flex h-9 min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-3 font-normal transition-[background-color] duration-120 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-transparent hover:text-sidebar-foreground focus-visible:ring-2 active:bg-transparent active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-transparent data-active:text-sidebar-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
					],
					className,
				),
			},
			props,
		),
		render,
		state: {
			"vem-ui": true,
			slot: "sidebar-menu-sub-button",
			sidebar: "menu-sub-button",
			size,
			active: isActive,
		},
	});
	return flyout ? <Menu.Item render={element} /> : element;
}
// SPDX-SnippetEnd

export {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
};
