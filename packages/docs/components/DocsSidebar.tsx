// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
	Sidebar,
	type SidebarProps,
	useSidebar,
} from "fumadocs-ui/layouts/docs/slots/sidebar";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export function DocsSidebar(props: SidebarProps) {
	const { open, mode } = useSidebar();
	const pathname = usePathname();
	const session = useRef<{
		returnTo: HTMLElement | null;
		pathname: string;
		focusInside: boolean;
	} | null>(null);

	useLayoutEffect(() => {
		const panel = document.getElementById("nd-sidebar-mobile");
		if (open && mode === "drawer" && panel) {
			session.current ??= {
				returnTo:
					document.activeElement instanceof HTMLElement
						? document.activeElement
						: null,
				pathname,
				focusInside: false,
			};
			const current = session.current;
			function trackFocus(event: FocusEvent) {
				const inside =
					event.target instanceof Node && panel?.contains(event.target);
				if (
					inside &&
					!current.focusInside &&
					event.relatedTarget instanceof HTMLElement
				) {
					current.returnTo = event.relatedTarget;
				}
				current.focusInside = Boolean(inside);
			}
			document.addEventListener("focusin", trackFocus);
			return () => document.removeEventListener("focusin", trackFocus);
		}
		const current = session.current;
		session.current = null;
		const active = document.activeElement;
		// Fumadocs restores on animationend, which is not guaranteed after an interrupted opening.
		if (
			!open &&
			mode === "drawer" &&
			current?.pathname === pathname &&
			current.returnTo?.isConnected &&
			(panel?.contains(active) ||
				(active === document.body && current.focusInside))
		) {
			current.returnTo.focus({ preventScroll: true });
		}
	}, [open, mode, pathname]);

	return <Sidebar {...props} />;
}
