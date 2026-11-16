// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
	defaultRangeExtractor,
	observeElementRect,
	type Rect,
	useVirtualizer,
	type Virtualizer,
} from "@tanstack/react-virtual";
import {
	type ComponentPropsWithRef,
	type CSSProperties,
	type ReactNode,
	type Ref,
	useCallback,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MeasuredRow } from "./internal/measured-row.js";

/** Position and viewport visibility of one rendered row. Overscan does not make a row visible. */
export interface VirtualListItemState {
	index: number;
	visible: boolean;
}

/** Immediate, measurement-aware scrolling. Stable keys remain meaningful after filtering. */
export interface VirtualListHandle {
	scrollToIndex(
		index: number,
		align?: "auto" | "start" | "center" | "end",
	): void;
	scrollToKey(
		key: string | number,
		align?: "auto" | "start" | "center" | "end",
	): void;
}

export interface VirtualListProps<Item>
	extends Omit<ComponentPropsWithRef<"div">, "children"> {
	items: readonly Item[];
	/** A stable identity, not the current array index. */
	getItemKey(item: Item): string | number;
	/** An initial estimate in pixels; rendered rows are measured automatically. Defaults to 32. */
	estimateItemHeight?: number | ((item: Item, index: number) => number);
	/** Extra rendered rows on each side. Their visible state remains false. Defaults to 3. */
	overscan?: number;
	/** Space inside the viewport, in pixels. Defaults to 0. */
	inset?: number;
	/** Preserve an active descendant in the DOM when it scrolls outside the viewport. */
	activeIndex?: number;
	/** The initial row to reveal before rendering viewport-dependent content. */
	initialIndex?: number;
	actionsRef?: Ref<VirtualListHandle>;
	itemRole?: "listitem" | "presentation";
	children(item: Item, state: VirtualListItemState): ReactNode;
}

/** A measured vertical list. Constrain its height with CSS; its default maximum is 20rem. */
export function VirtualList<Item>({
	items,
	getItemKey,
	estimateItemHeight = 32,
	overscan = 3,
	inset = 0,
	activeIndex = -1,
	initialIndex = 0,
	actionsRef,
	itemRole = "listitem",
	children,
	ref,
	className,
	style,
	role = "list",
	onScroll,
	...props
}: VirtualListProps<Item>) {
	const element = useRef<HTMLDivElement | null>(null);
	const viewportChanged = useRef<((rect: Rect) => void) | undefined>(undefined);
	const observeViewport = useCallback(
		(
			instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
			notify: (rect: Rect) => void,
		) => {
			viewportChanged.current = notify;
			const stop = observeElementRect(instance, notify);
			return () => {
				viewportChanged.current = undefined;
				stop?.();
			};
		},
		[],
	);
	const [settledHeight, setSettledHeight] = useState<number>();
	const previousVisible = useRef(new Set<string | number | bigint>());
	const movements = useRef(new Set<Animation>());
	const stopMovement = useCallback(() => {
		for (const animation of movements.current) animation.cancel();
		movements.current.clear();
	}, []);
	const trackMovement = useCallback((animation: Animation) => {
		const active = movements.current;
		active.add(animation);
		void animation.finished
			.catch(() => {})
			.then(() => active.delete(animation));
	}, []);
	const keys = useMemo(() => items.map(getItemKey), [items, getItemKey]);
	const previousKeys = useRef<Set<string | number> | null>(null);
	const previousOrder = useRef<readonly (string | number)[]>(keys);
	const orderChanged =
		previousOrder.current.length !== keys.length ||
		previousOrder.current.some((key, index) => key !== keys[index]);
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: items.length,
		useAnimationFrameWithResizeObserver: true,
		observeElementRect: observeViewport,
		initialOffset: () => {
			let offset = inset;
			for (
				let index = 0;
				index < Math.min(initialIndex, items.length);
				index++
			) {
				offset +=
					typeof estimateItemHeight === "number"
						? estimateItemHeight
						: estimateItemHeight(items[index] as Item, index);
			}
			return offset;
		},
		getScrollElement: () => element.current,
		getItemKey: (index) => keys[index] ?? index,
		estimateSize: (index) =>
			typeof estimateItemHeight === "number"
				? estimateItemHeight
				: estimateItemHeight(items[index] as Item, index),
		overscan,
		paddingStart: inset,
		paddingEnd: inset,
		scrollPaddingStart: inset,
		scrollPaddingEnd: inset,
		rangeExtractor: (range) => {
			const indices = defaultRangeExtractor(range);
			if (
				activeIndex >= 0 &&
				activeIndex < items.length &&
				!indices.includes(activeIndex)
			) {
				indices.push(activeIndex);
				indices.sort((left, right) => left - right);
			}
			return indices;
		},
	});
	const attach = useCallback(
		(node: HTMLDivElement | null) => {
			element.current = node;
			const cleanup = typeof ref === "function" ? ref(node) : undefined;
			if (ref && typeof ref !== "function") ref.current = node;
			return () => {
				element.current = null;
				if (typeof cleanup === "function") cleanup();
				else if (typeof ref === "function") ref(null);
				else if (ref) ref.current = null;
			};
		},
		[ref],
	);
	useImperativeHandle(
		actionsRef,
		() => ({
			scrollToIndex(index, align = "auto") {
				if (index >= 0 && index < items.length) {
					stopMovement();
					virtualizer.scrollToIndex(index, { align });
				}
			},
			scrollToKey(key, align = "auto") {
				const index = keys.indexOf(key);
				if (index !== -1) {
					stopMovement();
					virtualizer.scrollToIndex(index, { align });
				}
			},
		}),
		[virtualizer, items.length, keys, stopMovement],
	);
	useLayoutEffect(() => {
		previousKeys.current = new Set(keys);
		previousOrder.current = keys;
	}, [keys]);
	const rows = virtualizer.getVirtualItems();
	const viewportHeight = virtualizer.scrollRect?.height ?? 0;
	const totalHeight = virtualizer.getTotalSize();
	// Initial estimates and shrinking content can precede the browser's clamped scroll position.
	const offset = Math.max(
		0,
		Math.min(virtualizer.scrollOffset ?? 0, totalHeight - viewportHeight),
	);
	const settled = settledHeight === totalHeight;
	const visibleKeys = new Set<string | number | bigint>();
	for (const row of rows) {
		const visible = settled
			? row.end > offset + inset && row.start < offset + viewportHeight - inset
			: previousVisible.current.has(row.key);
		if (visible) visibleKeys.add(row.key);
	}
	useLayoutEffect(() => {
		const node = element.current;
		if (!node || settled) return;
		// A changed content height must update the viewport before exposing new row demand.
		viewportChanged.current?.({
			width: node.offsetWidth,
			height: node.offsetHeight,
		});
		setSettledHeight(totalHeight);
	}, [settled, totalHeight]);
	useLayoutEffect(() => {
		previousVisible.current = visibleKeys;
	});
	return (
		<div
			{...props}
			ref={attach}
			role={role}
			onScroll={(event) => {
				stopMovement();
				onScroll?.(event);
			}}
			className={["vem-virtual-list", className].filter(Boolean).join(" ")}
			style={
				{ "--vem-virtual-size": `${totalHeight}px`, ...style } as CSSProperties
			}
		>
			<div
				role="presentation"
				className="vem-virtual-canvas"
				style={{ height: totalHeight }}
			>
				{rows.map((row) => {
					const item = items[row.index];
					if (item === undefined) return null;
					return (
						<MeasuredRow
							key={row.key}
							index={row.index}
							start={row.start}
							inset={inset}
							role={itemRole}
							count={items.length}
							measure={virtualizer.measureElement}
							visible={visibleKeys.has(row.key)}
							estimatedHeight={row.size}
							maxReflowDistance={viewportHeight}
							trackMovement={trackMovement}
							reflow={orderChanged && !virtualizer.isScrolling}
							entering={
								previousKeys.current !== null &&
								!previousKeys.current.has(getItemKey(item))
							}
						>
							{(visible) => children(item, { index: row.index, visible })}
						</MeasuredRow>
					);
				})}
			</div>
		</div>
	);
}
