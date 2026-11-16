// SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
// SPDX-License-Identifier: MIT
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/bases/base/ui/combobox.tsx
// Source: https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/styles/style-nova.css
// Reviewed upstream template and Nova styling; local adaptations are marked below.

"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
// SPDX-SnippetEnd
import * as React from "react";
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { cn } from "./internal/cn.js";
import { useListMotionRef } from "./internal/list-motion.js";
import { usePopupMotionRef } from "./internal/popup-motion.js";
import {
	VirtualComboboxContext,
	VirtualComboboxItemContext,
	VirtualComboboxSelectionContext,
} from "./internal/virtual-combobox-context.js";
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { Button } from "./button.js";
// SPDX-SnippetEnd
// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "./input-group.js";

// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function Combobox<
	Value,
	Multiple extends boolean | undefined = false,
	Item = Value,
>({
	virtualized,
	onInputValueChange,
	onItemHighlighted,
	onValueChange,
	onOpenChange,
	...props
}: ComboboxPrimitive.Root.Props<Value, Multiple, Item>) {
	const [localValue, setLocalValue] = React.useState(props.defaultValue);
	const [localOpen, setLocalOpen] = React.useState(props.defaultOpen ?? false);
	const selected = props.value !== undefined ? props.value : localValue;
	const selectedValues = props.multiple
		? Array.isArray(selected)
			? selected
			: []
		: [selected];
	const selection = {
		open: props.open ?? localOpen,
		isSameItem(left: unknown, right: unknown) {
			return (
				props.isItemEqualToValue?.(left as Value, right as Value) ??
				Object.is(left, right)
			);
		},
		isSelected(item: unknown) {
			return selectedValues.some(
				(value) =>
					value != null &&
					(props.isItemEqualToValue?.(item as Value, value as Value) ??
						Object.is(item, value)),
			);
		},
	};
	const [highlight, setHighlight] = React.useState({
		itemValue: undefined as unknown,
		searchRevision: 0,
		reason: "none" as "keyboard" | "pointer" | "none",
	});
	return (
		<VirtualComboboxContext value={virtualized ? highlight : null}>
			<VirtualComboboxSelectionContext value={virtualized ? selection : null}>
				<ComboboxPrimitive.Root<Value, Multiple, Item>
					{...props}
					virtualized={virtualized}
					onValueChange={(value, details) => {
						onValueChange?.(value, details);
						if (virtualized && !details.isCanceled && props.value === undefined)
							setLocalValue(value);
					}}
					onOpenChange={(open, details) => {
						onOpenChange?.(open, details);
						if (virtualized && !details.isCanceled && props.open === undefined)
							setLocalOpen(open);
					}}
					onInputValueChange={(value, details) => {
						onInputValueChange?.(value, details);
						if (
							virtualized &&
							(details.reason === "input-change" ||
								details.reason === "input-clear")
						) {
							setHighlight((current) => ({
								...current,
								searchRevision: current.searchRevision + 1,
							}));
						}
					}}
					onItemHighlighted={(value, details) => {
						onItemHighlighted?.(value, details);
						if (virtualized)
							setHighlight((current) => ({
								...current,
								itemValue: value,
								reason: details.reason,
							}));
					}}
				/>
			</VirtualComboboxSelectionContext>
		</VirtualComboboxContext>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
	return (
		<ComboboxPrimitive.Value
			data-vem-ui=""
			data-slot="combobox-value"
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxTrigger({
	className,
	children,
	...props
}: Omit<ComboboxPrimitive.Trigger.Props, "className"> & {
	className?: string;
}) {
	return (
		<ComboboxPrimitive.Trigger
			data-vem-ui=""
			data-slot="combobox-trigger"
			className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
			{...props}
		>
			{children}
			<IconChevronDown
				data-vem-ui=""
				className={cn("pointer-events-none size-4 text-muted-foreground")}
			/>
		</ComboboxPrimitive.Trigger>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxClear({
	className,
	...props
}: Omit<ComboboxPrimitive.Clear.Props, "className"> & { className?: string }) {
	return (
		<ComboboxPrimitive.Clear
			data-vem-ui=""
			data-slot="combobox-clear"
			aria-label="Clear selection"
			render={<InputGroupButton variant="ghost" size="icon-xs" />}
			className={cn([], className)}
			{...props}
		>
			<IconX data-vem-ui="" className={cn("pointer-events-none")} />
		</ComboboxPrimitive.Clear>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxInput({
	className,
	children,
	disabled = false,
	showTrigger = true,
	showClear = false,
	...props
}: Omit<ComboboxPrimitive.Input.Props, "className"> & { className?: string } & {
	showTrigger?: boolean;
	showClear?: boolean;
}) {
	return (
		<InputGroup data-vem-ui="" className={cn("w-auto", className)}>
			<ComboboxPrimitive.Input
				render={<InputGroupInput disabled={disabled} />}
				{...props}
			/>
			<InputGroupAddon align="inline-end">
				{showTrigger && (
					<InputGroupButton
						data-vem-ui=""
						size="icon-xs"
						variant="ghost"
						render={<ComboboxTrigger aria-label="Show suggestions" />}
						data-slot="input-group-button"
						className={cn(
							"group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent",
						)}
						disabled={disabled}
					/>
				)}
				{showClear && <ComboboxClear disabled={disabled} />}
			</InputGroupAddon>
			{children}
		</InputGroup>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxContent({
	children,
	ref,
	container,
	className,
	side = "bottom",
	sideOffset = 6,
	align = "start",
	alignOffset = 0,
	anchor,
	...props
}: Omit<ComboboxPrimitive.Popup.Props, "className"> & { className?: string } & {
	container?: ComboboxPrimitive.Portal.Props["container"];
} & Pick<
		ComboboxPrimitive.Positioner.Props,
		"side" | "align" | "sideOffset" | "alignOffset" | "anchor"
	>) {
	const motionRef = usePopupMotionRef(ref);
	return (
		<ComboboxPrimitive.Portal container={container}>
			<ComboboxPrimitive.Positioner
				data-vem-ui=""
				side={side}
				sideOffset={sideOffset}
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				className={cn("isolate z-50")}
			>
				<ComboboxPrimitive.Popup
					ref={motionRef}
					data-vem-ui=""
					data-slot="combobox-content"
					data-chips={!!anchor}
					className={cn(
						"group/combobox-content relative flex flex-col max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-(--vem-combobox-duration) ease-(--vem-combobox-easing) data-[chips=true]:min-w-(--anchor-width) data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					<div
						data-vem-ui=""
						className={cn(
							"vem-combobox-body *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:border-input/30 *:data-[slot=input-group]:bg-input/30 *:data-[slot=input-group]:shadow-none",
						)}
					>
						{children}
					</div>
				</ComboboxPrimitive.Popup>
			</ComboboxPrimitive.Positioner>
		</ComboboxPrimitive.Portal>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxList({
	className,
	ref,
	...props
}: Omit<
	React.ComponentPropsWithRef<typeof ComboboxPrimitive.List>,
	"className"
> & { className?: string }) {
	const motionRef = useListMotionRef(ref);
	return (
		<ComboboxPrimitive.List
			ref={motionRef}
			data-vem-ui=""
			data-slot="combobox-list"
			className={cn(
				"vem-combobox-list max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
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
function ComboboxItem({
	className,
	children,
	indicatorSide = "start",
	...props
}: Omit<ComboboxPrimitive.Item.Props, "className"> & {
	className?: string;
	indicatorSide?: "start" | "end";
}) {
	const virtual = React.useContext(VirtualComboboxItemContext);
	return (
		<ComboboxPrimitive.Item
			index={virtual?.index}
			aria-setsize={virtual?.count}
			aria-posinset={virtual ? virtual.index + 1 : undefined}
			data-vem-ui=""
			data-slot="combobox-item"
			className={cn(
				[
					"relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pe-1.5 ps-8 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
					indicatorSide === "end" && "ps-2 pe-8",
				],
				className,
			)}
			{...props}
		>
			{children}
			<ComboboxPrimitive.ItemIndicator
				render={
					<span
						data-vem-ui=""
						className={cn([
							"pointer-events-none absolute flex size-4 items-center justify-center",
							indicatorSide === "end" ? "end-2" : "start-2",
						])}
					/>
				}
			>
				<IconCheck data-vem-ui="" className={cn("pointer-events-none")} />
			</ComboboxPrimitive.ItemIndicator>
		</ComboboxPrimitive.Item>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxGroup({
	className,
	...props
}: Omit<ComboboxPrimitive.Group.Props, "className"> & { className?: string }) {
	return (
		<ComboboxPrimitive.Group
			data-vem-ui=""
			data-slot="combobox-group"
			className={cn([], className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxLabel({
	className,
	...props
}: Omit<ComboboxPrimitive.GroupLabel.Props, "className"> & {
	className?: string;
}) {
	return (
		<ComboboxPrimitive.GroupLabel
			data-vem-ui=""
			data-slot="combobox-label"
			className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
	return (
		<ComboboxPrimitive.Collection
			data-vem-ui=""
			data-slot="combobox-collection"
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxEmpty({
	className,
	...props
}: Omit<ComboboxPrimitive.Empty.Props, "className"> & { className?: string }) {
	return (
		<ComboboxPrimitive.Empty
			data-vem-ui=""
			data-slot="combobox-empty"
			className={cn(
				"hidden w-full justify-center py-2 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex",
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
function ComboboxSeparator({
	className,
	...props
}: Omit<ComboboxPrimitive.Separator.Props, "className"> & {
	className?: string;
}) {
	return (
		<ComboboxPrimitive.Separator
			data-vem-ui=""
			data-slot="combobox-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxChips({
	className,
	...props
}: Omit<
	React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
		ComboboxPrimitive.Chips.Props,
	"className"
> & { className?: string }) {
	return (
		<ComboboxPrimitive.Chips
			data-vem-ui=""
			data-slot="combobox-chips"
			className={cn(
				"flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent bg-clip-padding px-2.5 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 has-data-[slot=combobox-chip]:px-1 dark:bg-input/30 dark:has-aria-invalid:border-destructive/50 dark:has-aria-invalid:ring-destructive/40",
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
function ComboboxChip({
	className,
	children,
	showRemove = true,
	...props
}: Omit<ComboboxPrimitive.Chip.Props, "className"> & { className?: string } & {
	showRemove?: boolean;
}) {
	return (
		<ComboboxPrimitive.Chip
			data-vem-ui=""
			data-slot="combobox-chip"
			className={cn(
				"flex h-[calc(--spacing(5.25))] w-fit items-center justify-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap text-foreground has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0",
				className,
			)}
			{...props}
		>
			{children}
			{showRemove && (
				<ComboboxPrimitive.ChipRemove
					data-vem-ui=""
					render={<Button variant="ghost" size="icon-xs" />}
					className={cn("-ml-1 opacity-50 hover:opacity-100")}
					data-slot="combobox-chip-remove"
					aria-label="Remove item"
				>
					<IconX data-vem-ui="" className={cn("pointer-events-none")} />
				</ComboboxPrimitive.ChipRemove>
			)}
		</ComboboxPrimitive.Chip>
	);
}
// SPDX-SnippetEnd

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
function ComboboxChipsInput({
	className,
	...props
}: Omit<ComboboxPrimitive.Input.Props, "className"> & { className?: string }) {
	return (
		<ComboboxPrimitive.Input
			data-vem-ui=""
			data-slot="combobox-chip-input"
			className={cn("min-w-16 flex-1 outline-none", className)}
			{...props}
		/>
	);
}
// SPDX-SnippetEnd

function useComboboxAnchor() {
	return React.useRef<HTMLDivElement | null>(null);
}

export {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
	ComboboxGroup,
	ComboboxLabel,
	ComboboxCollection,
	ComboboxEmpty,
	ComboboxSeparator,
	ComboboxChips,
	ComboboxChip,
	ComboboxChipsInput,
	ComboboxTrigger,
	ComboboxValue,
	useComboboxAnchor,
};
