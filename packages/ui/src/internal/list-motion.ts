// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { type Ref, useCallback } from "react";

const itemSelector = '[data-slot="combobox-item"]';
const duration = 140;
const maxAnimatedItems = 100;

function layoutTop(element: HTMLElement) {
	let top = 0;
	for (
		let node: HTMLElement | null = element;
		node;
		node = node.offsetParent as HTMLElement | null
	)
		top += node.offsetTop;
	return top;
}

function observeList(list: HTMLElement) {
	const view = list.ownerDocument.defaultView;
	if (!view || typeof list.animate !== "function") return () => {};
	const motion = view.matchMedia("(prefers-reduced-motion: no-preference)");
	const animations = new Map<HTMLElement, Animation>();
	let previous = new Map<HTMLElement, number>();
	const stop = () => {
		for (const animation of animations.values()) animation.cancel();
		animations.clear();
	};
	const capture = () => {
		const items = list.querySelectorAll<HTMLElement>(itemSelector);
		if (items.length > maxAnimatedItems) return new Map<HTMLElement, number>();
		const top = layoutTop(list);
		return new Map(
			[...items]
				.filter(
					(item) =>
						item.getClientRects().length &&
						item.closest('[data-slot="combobox-list"]') === list,
				)
				.map((item) => [item, layoutTop(item) - top]),
		);
	};
	const snapshot = () => {
		previous = capture();
	};
	const play = (element: HTMLElement, frames: Keyframe[]) => {
		const animation = element.animate(frames, {
			duration,
			easing: "cubic-bezier(0.2, 0, 0, 1)",
		});
		animations.set(element, animation);
		animation.finished.then(
			() => {
				if (animations.get(element) === animation) {
					animations.delete(element);
					if (!animations.size) snapshot();
				}
			},
			() => {},
		);
	};
	const reset = () => {
		stop();
		snapshot();
	};
	const resize = new ResizeObserver(() => {
		if (!animations.size) snapshot();
	});
	const observeSizes = () => {
		resize.disconnect();
		resize.observe(list);
		for (const item of previous.keys()) resize.observe(item);
	};
	const observer = new MutationObserver((records) => {
		const changed = records.some((record) =>
			[...record.addedNodes, ...record.removedNodes].some(
				(node) =>
					node.nodeType === 1 &&
					((node as Element).matches(itemSelector) ||
						(node as Element).querySelector(itemSelector)),
			),
		);
		if (!changed) return;
		const starts = new Map(
			[...previous]
				.filter(([item]) => list.contains(item))
				.map(([item, top]) => {
					const translate = animations.has(item)
						? view.getComputedStyle(item).translate.split(" ").at(-1)
						: "0";
					return [item, top + (Number.parseFloat(translate ?? "0") || 0)];
				}),
		);
		stop();
		const next = capture();
		if (motion.matches && list.getClientRects().length && next.size) {
			for (const [item, top] of next) {
				const old = starts.get(item);
				if (old === undefined)
					play(item, [
						{ opacity: 0, translate: "0 4px" },
						{ opacity: 1, translate: "0 0" },
					]);
				else if (Math.abs(old - top) > 0.5)
					play(item, [{ translate: `0 ${old - top}px` }, { translate: "0 0" }]);
			}
		}
		previous = next;
		observeSizes();
	});
	reset();
	observeSizes();
	observer.observe(list, { childList: true, subtree: true });
	motion.addEventListener("change", reset);
	return () => {
		observer.disconnect();
		resize.disconnect();
		motion.removeEventListener("change", reset);
		stop();
		previous.clear();
	};
}

/** Animate live options only; removed content is never retained for an exit effect. */
export function useListMotionRef(ref?: Ref<HTMLDivElement>) {
	return useCallback(
		(node: HTMLDivElement | null) => {
			const stop = node ? observeList(node) : undefined;
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
