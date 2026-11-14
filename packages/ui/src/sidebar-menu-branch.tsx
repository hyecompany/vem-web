// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Menu } from "@base-ui/react/menu";
import { IconChevronRight } from "@tabler/icons-react";
import {
	type ComponentProps,
	cloneElement,
	type ReactElement,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { SidebarBranchContext } from "./internal/sidebar-branch-context.js";
import { sidebarPressHandlers } from "./internal/sidebar-press.js";
import { type SidebarMenuButton, useSidebar } from "./sidebar.js";

/** A sidebar link with an independent disclosure and a compact-mode flyout. */
export interface SidebarMenuBranchProps {
	/** The parent link or button, composed with SidebarMenuButton. */
	trigger: ReactElement<ComponentProps<typeof SidebarMenuButton>>;
	/** Accessible name used by the separate expand/collapse control. */
	label: string;
	/** Ordinary SidebarMenuSub, SidebarMenuSubItem, and SidebarMenuSubButton children. */
	children: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Optional portal destination for a scoped theme. Defaults to the document body. */
	container?: ComponentProps<typeof Menu.Portal>["container"];
}

function BranchTrigger({
	onNavigate,
	...props
}: Menu.Trigger.Props & { onNavigate: () => void }) {
	const input = useRef<string | null>(null);
	return (
		<Menu.Trigger
			{...props}
			openOnHover
			closeDelay={120}
			onPointerDown={(event) => {
				input.current = event.pointerType;
			}}
			onMouseDown={(event) => {
				if (input.current === "mouse") event.preventBaseUIHandler();
			}}
			onKeyDown={(event) => {
				input.current = event.key === " " ? "menu" : "navigation";
				if (event.key === "Enter") event.preventBaseUIHandler();
			}}
			onClick={(event) => {
				const activation = input.current;
				input.current = null;
				if (
					activation === "touch" ||
					activation === "pen" ||
					activation === "menu"
				)
					event.preventDefault();
				else {
					event.preventBaseUIHandler();
					onNavigate();
				}
			}}
		/>
	);
}

export function SidebarMenuBranch({
	trigger,
	label,
	children,
	open: controlledOpen,
	defaultOpen = false,
	onOpenChange,
	container,
}: SidebarMenuBranchProps) {
	const { state, isMobile } = useSidebar();
	const compact = !isMobile && state === "collapsed";
	const [localOpen, setLocalOpen] = useState(defaultOpen);
	const [flyout, setFlyout] = useState(false);
	const open = controlledOpen ?? localOpen;
	const row = useRef<HTMLDivElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const id = useId();
	const changeOpen = (next: boolean) => {
		if (controlledOpen === undefined) setLocalOpen(next);
		onOpenChange?.(next);
	};
	const cancelHover = () => {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}
	};
	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current);
		},
		[],
	);
	useEffect(() => {
		if (!compact) setFlyout(false);
	}, [compact]);
	useLayoutEffect(() => {
		if (compact || !row.current) return;
		const element = row.current;
		const text = element.querySelector<HTMLElement>(
			"[data-slot=sidebar-menu-button] > span:last-child",
		);
		if (!text) return;
		const update = () => {
			const bounds = element.getBoundingClientRect();
			const rtl = getComputedStyle(element).direction === "rtl";
			const labelBounds = text.getBoundingClientRect();
			const protectedEnd =
				(rtl
					? bounds.right - labelBounds.left
					: labelBounds.right - bounds.left) + 12;
			const boundary =
				protectedEnd + Math.max(0, bounds.width - 28 - protectedEnd) / 2;
			element.style.setProperty(
				"--disclosure-width",
				`${Math.min(bounds.width, Math.max(40, bounds.width - boundary))}px`,
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(element);
		observer.observe(text);
		update();
		return () => observer.disconnect();
	}, [compact]);
	const compactTrigger = cloneElement(trigger, {
		tooltip: undefined,
		render: (
			<BranchTrigger
				nativeButton={!trigger.props.render}
				render={trigger.props.render}
				onNavigate={() => setFlyout(false)}
			/>
		),
	});
	return (
		<Menu.Root open={compact && flyout} onOpenChange={setFlyout}>
			<div
				data-vem-ui=""
				className="vem-sidebar-branch"
				data-collapsed={compact ? "" : undefined}
			>
				<div
					{...sidebarPressHandlers}
					ref={row}
					data-vem-ui=""
					className="vem-sidebar-branch-row vem-sidebar-press"
					data-active={trigger.props.isActive || undefined}
				>
					{compact ? compactTrigger : trigger}
					{!compact && (
						<button
							data-vem-ui=""
							type="button"
							className="vem-sidebar-branch-disclosure"
							aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
							aria-expanded={open}
							aria-controls={id}
							onPointerEnter={(event) => {
								cancelHover();
								if (event.pointerType === "mouse" && !isMobile && !open)
									timer.current = setTimeout(() => {
										timer.current = null;
										changeOpen(true);
									}, 700);
							}}
							onPointerLeave={cancelHover}
							onPointerDown={cancelHover}
							onPointerCancel={cancelHover}
							onClick={() => {
								cancelHover();
								changeOpen(!open);
							}}
						>
							<span data-press-visual="">
								<IconChevronRight
									className="vem-sidebar-branch-chevron"
									aria-hidden="true"
								/>
							</span>
						</button>
					)}
				</div>
				{
					<div
						data-vem-ui=""
						id={id}
						className="vem-sidebar-branch-panel"
						data-open={open && !compact ? "" : undefined}
						aria-hidden={!open || compact}
						inert={!open || compact}
					>
						<div>{compact && flyout ? null : children}</div>
					</div>
				}
			</div>
			{compact && (
				<Menu.Portal container={container}>
					<Menu.Positioner
						data-vem-ui=""
						side="inline-end"
						align="start"
						sideOffset={12}
						style={{ zIndex: 50 }}
					>
						<Menu.Popup
							data-vem-ui=""
							className="vem-sidebar-branch-popup"
							aria-label={label}
						>
							<Menu.Item
								render={cloneElement(trigger, {
									tooltip: undefined,
									role: "menuitem",
								})}
							/>
							<Menu.Separator
								data-vem-ui=""
								className="vem-sidebar-branch-separator"
							/>
							<SidebarBranchContext value={true}>
								{children}
							</SidebarBranchContext>
						</Menu.Popup>
					</Menu.Positioner>
				</Menu.Portal>
			)}
		</Menu.Root>
	);
}
