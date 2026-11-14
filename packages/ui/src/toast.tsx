// SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
// SPDX-License-Identifier: MIT
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/bases/base/ui/toast.tsx
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/styles/style-nova.css
// Reviewed upstream template and Nova styling; local adaptations are marked below.

"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import {
	IconAlertOctagon,
	IconAlertTriangle,
	IconCircleCheck,
	IconInfoCircle,
	IconLoader,
	IconX,
} from "@tabler/icons-react";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import type * as React from "react";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { cn } from "./internal/cn.js";
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Button } from "./button.js";

// SPDX-SnippetEnd

const toast = ToastPrimitive.createToastManager();

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
	return <ToastPrimitive.Provider {...props} />;
}

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
	return (
		<ToastPrimitive.Portal data-vem-ui="" data-slot="toast-portal" {...props} />
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastViewport({
	className,
	...props
}: Omit<ToastPrimitive.Viewport.Props, "className"> & { className?: string }) {
	return (
		<ToastPrimitive.Viewport
			data-vem-ui=""
			data-slot="toast-viewport"
			className={cn(
				"pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
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
function Toast({
	className,
	...props
}: Omit<ToastPrimitive.Root.Props, "className"> & { className?: string }) {
	return (
		<ToastPrimitive.Root
			data-vem-ui=""
			data-slot="toast"
			className={cn(
				[
					"group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-2xl border bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
					"[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
					"h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
					"after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
					"data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
					"data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
					"[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
					"data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
					"data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
					"data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
					"data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
					"data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
					"data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
					"data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
					"data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
				],
				className,
			)}
			{...props}
			inert={props.toast.transitionStatus === "ending" || props.inert}
			aria-hidden={
				props.toast.transitionStatus === "ending" || props["aria-hidden"]
			}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastContent({
	className,
	...props
}: Omit<ToastPrimitive.Content.Props, "className"> & { className?: string }) {
	return (
		<ToastPrimitive.Content
			data-vem-ui=""
			data-slot="toast-content"
			className={cn(
				"flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
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
function ToastTitle({
	className,
	...props
}: Omit<ToastPrimitive.Title.Props, "className"> & { className?: string }) {
	return (
		<ToastPrimitive.Title
			data-vem-ui=""
			data-slot="toast-title"
			className={cn("text-sm font-medium", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastDescription({
	className,
	...props
}: Omit<ToastPrimitive.Description.Props, "className"> & {
	className?: string;
}) {
	return (
		<ToastPrimitive.Description
			data-vem-ui=""
			data-slot="toast-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastAction({
	className,
	render = <Button variant="outline" size="sm" />,
	...props
}: Omit<ToastPrimitive.Action.Props, "className"> & { className?: string }) {
	return (
		<ToastPrimitive.Action
			data-vem-ui=""
			data-slot="toast-action"
			render={render}
			className={cn("shrink-0", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastClose({
	className,
	children,
	render = <Button variant="ghost" size="icon-sm" />,
	...props
}: Omit<ToastPrimitive.Close.Props, "className"> & { className?: string }) {
	return (
		<ToastPrimitive.Close
			data-vem-ui=""
			data-slot="toast-close"
			aria-label="Close toast"
			render={render}
			className={cn(
				"relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
				className,
			)}
			{...props}
		>
			{children ?? <IconX aria-hidden="true" />}
		</ToastPrimitive.Close>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastIcon({ type }: { type: string | undefined }) {
	let icon: React.ReactNode = null;

	if (type === "success") {
		icon = <IconCircleCheck aria-hidden="true" />;
	}

	if (type === "info") {
		icon = <IconInfoCircle aria-hidden="true" />;
	}

	if (type === "warning") {
		icon = <IconAlertTriangle aria-hidden="true" />;
	}

	if (type === "error") {
		icon = (
			<IconAlertOctagon
				data-vem-ui=""
				className={cn("text-destructive")}
				aria-hidden="true"
			/>
		);
	}

	if (type === "loading") {
		icon = (
			<IconLoader
				data-vem-ui=""
				className={cn("animate-spin")}
				aria-hidden="true"
			/>
		);
	}

	if (!icon) {
		return null;
	}

	return (
		<span
			data-vem-ui=""
			data-slot="toast-icon"
			className={cn(
				"shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
			)}
		>
			{icon}
		</span>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ToastList() {
	const { toasts } = ToastPrimitive.useToastManager();

	return toasts.map((toastItem) => (
		<Toast key={toastItem.id} toast={toastItem}>
			<ToastContent>
				<ToastIcon type={toastItem.type} />
				<div
					data-vem-ui=""
					className={cn("flex min-w-0 flex-1 flex-col gap-1")}
				>
					<ToastTitle />
					<ToastDescription />
				</div>
				<ToastAction />
				<ToastClose />
			</ToastContent>
		</Toast>
	));
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function Toaster({
	container,
	children,
	toastManager = toast,
	...props
}: ToastPrimitive.Provider.Props & {
	container?: ToastPrimitive.Portal.Props["container"];
}) {
	return (
		<ToastProvider toastManager={toastManager} {...props}>
			{children}
			<ToastPortal container={container}>
				<ToastViewport>
					<ToastList />
				</ToastViewport>
			</ToastPortal>
		</ToastProvider>
	);
}
// SPDX-SnippetEnd

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
	Toaster,
	Toast,
	ToastAction,
	ToastClose,
	ToastContent,
	ToastDescription,
	ToastPortal,
	ToastProvider,
	ToastTitle,
	ToastViewport,
	createToastManager,
	toast,
	useToastManager,
};
