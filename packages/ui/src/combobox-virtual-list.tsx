// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Combobox as Primitive } from "@base-ui/react/combobox";
import { useContext, useLayoutEffect, useRef, useState } from "react";
import {
	VirtualComboboxContext,
	VirtualComboboxItemContext,
	VirtualComboboxSelectionContext,
} from "./internal/virtual-combobox-context.js";
import {
	VirtualList,
	type VirtualListHandle,
	type VirtualListProps,
} from "./virtual-list.js";

export type ComboboxVirtualListProps<Item> = Omit<
	VirtualListProps<Item>,
	| "items"
	| "initialIndex"
	| "activeIndex"
	| "itemRole"
	| "role"
	| "actionsRef"
	| "inset"
>;

/** Replace ComboboxList under a virtualized Combobox with full items at the root. */
export function ComboboxVirtualList<Item>({
	children,
	getItemKey,
	estimateItemHeight,
	overscan,
	...props
}: ComboboxVirtualListProps<Item>) {
	const items = Primitive.useFilteredItems<Item>();
	const highlight = useContext(VirtualComboboxContext);
	const actions = useRef<VirtualListHandle>(null);
	const selection = useContext(VirtualComboboxSelectionContext);
	const highlightedIndex =
		highlight?.itemValue !== undefined
			? items.findIndex((item) =>
					selection?.isSameItem(item, highlight.itemValue),
				)
			: -1;
	const selectedIndex = selection ? items.findIndex(selection.isSelected) : -1;
	const open = selection?.open ?? false;
	const [revealedSelection, setRevealedSelection] = useState(false);
	useLayoutEffect(() => {
		if (!open) {
			setRevealedSelection(false);
			return;
		}
		if (!revealedSelection && selectedIndex >= 0) {
			actions.current?.scrollToIndex(selectedIndex);
			setRevealedSelection(true);
		}
	}, [open, selectedIndex, revealedSelection]);
	const searchRevision = highlight?.searchRevision;
	const lastSearchRevision = useRef(searchRevision);
	const pendingReveal = open && !revealedSelection && selectedIndex > 0;
	useLayoutEffect(() => {
		if (lastSearchRevision.current !== searchRevision)
			actions.current?.scrollToIndex(0, "start");
		lastSearchRevision.current = searchRevision;
	}, [searchRevision]);
	useLayoutEffect(() => {
		if (highlight && highlight.reason === "keyboard" && highlightedIndex >= 0) {
			actions.current?.scrollToIndex(highlightedIndex);
		}
	}, [highlight, highlightedIndex]);
	if (!highlight)
		throw new Error(
			"ComboboxVirtualList requires <Combobox virtualized items={...}>.",
		);
	return (
		<Primitive.List
			{...props}
			render={(listProps) => (
				<VirtualList
					{...listProps}
					data-vem-ui=""
					data-slot="combobox-list"
					className={["vem-combobox-virtual-list", listProps.className]
						.filter(Boolean)
						.join(" ")}
					items={items}
					getItemKey={getItemKey}
					estimateItemHeight={estimateItemHeight}
					overscan={overscan}
					activeIndex={highlightedIndex}
					initialIndex={Math.max(0, selectedIndex)}
					actionsRef={actions}
					itemRole="presentation"
					inset={4}
				>
					{(item, state) => (
						<VirtualComboboxItemContext
							value={{ index: state.index, count: items.length }}
						>
							{children(item, {
								...state,
								visible: state.visible && !pendingReveal,
							})}
						</VirtualComboboxItemContext>
					)}
				</VirtualList>
			)}
		/>
	);
}
