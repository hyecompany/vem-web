// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { type Ref, useCallback } from "react";

function observePopup(popup: HTMLDivElement) {
	const view = popup.ownerDocument.defaultView;
	if (!view || typeof popup.animate !== "function") return () => {};
	const motion = view.matchMedia("(prefers-reduced-motion: no-preference)");
	let height = popup.offsetHeight;
	let animation: Animation | undefined;
	let frame = 0;
	const stop = () => {
		animation?.cancel();
		animation = undefined;
	};
	const reset = () => {
		view.cancelAnimationFrame(frame);
		frame = 0;
		stop();
		height = popup.offsetHeight;
	};
	const resize = () => {
		const previous = animation
			? Number.parseFloat(view.getComputedStyle(popup).height)
			: height;
		stop();
		height = popup.offsetHeight;
		const open = popup.hasAttribute("data-open");
		if (
			!motion.matches ||
			previous === 0 ||
			(open && Math.abs(previous - height) < 1)
		)
			return;
		const style = view.getComputedStyle(popup);
		const time = style.getPropertyValue("--vem-combobox-duration").trim();
		const duration = Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);
		const target = open ? height : previous;
		const current = popup.animate(
			[{ height: `${previous}px` }, { height: `${target}px` }],
			{
				duration: Number.isFinite(duration) ? duration : 160,
				easing:
					style.getPropertyValue("--vem-combobox-easing").trim() || "ease-out",
			},
		);
		animation = current;
		void current.finished.then(
			() => {
				if (animation !== current) return;
				animation = undefined;
				if (popup.hasAttribute("data-open")) schedule();
			},
			() => {},
		);
	};
	const schedule = () => {
		if (frame) return;
		frame = view.requestAnimationFrame(() => {
			frame = 0;
			resize();
		});
	};
	const observer = new ResizeObserver(() => {
		if (!animation && !frame) height = popup.offsetHeight;
	});
	const mutations = new MutationObserver(schedule);
	observer.observe(popup);
	mutations.observe(popup, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: ["data-open"],
	});
	motion.addEventListener("change", reset);
	return () => {
		view.cancelAnimationFrame(frame);
		observer.disconnect();
		mutations.disconnect();
		motion.removeEventListener("change", reset);
		stop();
	};
}

/** Ease the frame to its current content without retaining removed options or messages. */
export function usePopupMotionRef(ref?: Ref<HTMLDivElement>) {
	return useCallback(
		(node: HTMLDivElement | null) => {
			const stop = node ? observePopup(node) : undefined;
			const cleanup = typeof ref === "function" ? ref(node) : undefined;
			if (ref && typeof ref !== "function") ref.current = node;
			return () => {
				stop?.();
				if (typeof cleanup === "function") cleanup();
				else if (typeof ref === "function") ref(null);
				else if (ref) ref.current = null;
			};
		},
		[ref],
	);
}
