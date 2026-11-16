// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
	type ReactNode,
	type RefCallback,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

interface MeasuredRowProps {
	children(visible: boolean): ReactNode;
	index: number;
	start: number;
	inset: number;
	role: "listitem" | "presentation";
	count: number;
	measure: RefCallback<HTMLDivElement>;
	entering: boolean;
	visible: boolean;
	reflow: boolean;
	estimatedHeight: number;
	maxReflowDistance: number;
	trackMovement(animation: Animation): void;
}

export function MeasuredRow({
	children,
	index,
	start,
	inset,
	role,
	count,
	measure,
	entering,
	visible,
	reflow,
	estimatedHeight,
	maxReflowDistance,
	trackMovement,
}: MeasuredRowProps) {
	const content = useRef<HTMLDivElement>(null);
	const row = useRef<HTMLDivElement>(null);
	const lastTop = useRef(start);
	const movement = useRef<Animation | null>(null);
	const attach = useCallback(
		(element: HTMLDivElement | null) => {
			row.current = element;
			return measure(element);
		},
		[measure],
	);
	useLayoutEffect(() => {
		const element = row.current;
		const previous = lastTop.current;
		lastTop.current = start;
		if (
			!element ||
			!reflow ||
			previous === start ||
			Math.abs(previous - start) > maxReflowDistance ||
			!element.animate ||
			element.ownerDocument.defaultView?.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches
		)
			return;
		movement.current?.cancel();
		movement.current = element.animate(
			[{ translate: `0 ${previous - start}px` }, { translate: "0 0" }],
			{ duration: 140, easing: "ease-out" },
		);

		trackMovement(movement.current);
	}, [start, reflow, maxReflowDistance, trackMovement]);
	useLayoutEffect(() => () => movement.current?.cancel(), []);
	const [animateEntrance] = useState(entering);
	const [height, setHeight] = useState<number>();
	useLayoutEffect(() => {
		const element = row.current;
		if (!element || height === undefined || !element.getAnimations) return;
		const transitions = element
			.getAnimations()
			.filter(
				(animation) =>
					"transitionProperty" in animation &&
					animation.transitionProperty === "height",
			);
		if (!transitions.length) return;
		let current = true;
		element.dataset.resizing = "";
		void Promise.allSettled(
			transitions.map((transition) => transition.finished),
		).then(() => {
			if (current) delete element.dataset.resizing;
		});
		return () => {
			current = false;
			delete element.dataset.resizing;
		};
	}, [height]);
	useLayoutEffect(() => {
		const element = content.current;
		if (!element) return;
		const update = () => {
			setHeight(element.offsetHeight);
		};
		if (!visible) return;
		update();
		let frame = 0;
		const view = element.ownerDocument.defaultView;
		if (!view) return;
		const observer = new ResizeObserver(() => {
			if (frame) return;
			frame = view.requestAnimationFrame(() => {
				frame = 0;
				update();
			});
		});
		observer.observe(element);
		return () => {
			view.cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [visible]);
	return (
		<div
			ref={attach}
			data-index={index}
			data-vem-virtual-row=""
			data-outside={!visible || undefined}
			role={role}
			{...(role === "listitem"
				? { "aria-setsize": count, "aria-posinset": index + 1 }
				: {})}
			className="vem-virtual-row"
			style={{
				top: start,
				left: inset,
				right: inset,
				height: height ?? (visible ? undefined : estimatedHeight),
			}}
		>
			<div
				ref={content}
				className="vem-virtual-row-content"
				data-entering={animateEntrance || undefined}
			>
				{children(visible)}
			</div>
		</div>
	);
}
