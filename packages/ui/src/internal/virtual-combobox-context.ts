// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createContext } from "react";

export interface VirtualComboboxHighlight {
	itemValue: unknown;
	searchRevision: number;
	reason: "keyboard" | "pointer" | "none";
}

export const VirtualComboboxContext =
	createContext<VirtualComboboxHighlight | null>(null);
export const VirtualComboboxItemContext = createContext<{
	index: number;
	count: number;
} | null>(null);

export const VirtualComboboxSelectionContext = createContext<{
	open: boolean;
	isSelected(item: unknown): boolean;
	isSameItem(left: unknown, right: unknown): boolean;
} | null>(null);
