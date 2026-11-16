// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { RootProvider } from "fumadocs-ui/provider/next";
import { lazy, type ReactNode } from "react";

const SearchDialog = lazy(() => import("./SearchDialog"));

export function DocsProvider({ children }: { children: ReactNode }) {
	return (
		<RootProvider search={{ preload: false, SearchDialog }}>
			{children}
		</RootProvider>
	);
}
