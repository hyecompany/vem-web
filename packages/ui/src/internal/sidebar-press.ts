// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent, PointerEvent } from "react";

function setOrigin(surface: HTMLElement, x: number, y: number) {
	surface.style.setProperty("--press-x", `${x}px`);
	surface.style.setProperty("--press-y", `${y}px`);
	for (const visual of surface.querySelectorAll<HTMLElement>(
		"[data-press-visual], [data-slot=sidebar-menu-button] > svg, [data-slot=sidebar-menu-button] > span, [data-slot=sidebar-menu-sub-button] > svg, [data-slot=sidebar-menu-sub-button] > span",
	)) {
		const visualBounds = visual.getBoundingClientRect();
		const surfaceBounds = surface.getBoundingClientRect();
		visual.style.setProperty(
			"--press-x",
			`${x - (visualBounds.left - surfaceBounds.left)}px`,
		);
		visual.style.setProperty(
			"--press-y",
			`${y - (visualBounds.top - surfaceBounds.top)}px`,
		);
	}
}
export const sidebarPressHandlers = {
	onPointerDownCapture(event: PointerEvent<HTMLElement>) {
		const surface = event.currentTarget;
		if (surface.parentElement?.classList.contains("vem-sidebar-branch-row"))
			return;
		const bounds = surface.getBoundingClientRect();
		const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
		const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
		setOrigin(surface, bounds.width - x, bounds.height - y);
	},
	onKeyDownCapture(event: KeyboardEvent<HTMLElement>) {
		if (event.key !== "Enter" && event.key !== " ") return;
		if (
			event.currentTarget.parentElement?.classList.contains(
				"vem-sidebar-branch-row",
			)
		)
			return;
		setOrigin(
			event.currentTarget,
			event.currentTarget.clientWidth / 2,
			event.currentTarget.clientHeight / 2,
		);
	},
};
