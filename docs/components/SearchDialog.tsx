// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useDocsSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
	SearchDialog as Dialog,
	SearchDialogClose,
	SearchDialogContent,
	SearchDialogHeader,
	SearchDialogIcon,
	SearchDialogInput,
	SearchDialogList,
	SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/contexts/search";
import { useRef } from "react";

export default function SearchDialog(props: SharedProps) {
	const previousFocus = useRef<HTMLElement | null>(null);
	const navigated = useRef(false);
	const search = useDocsSearch({
		client: staticClient({
			from: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/search`,
		}),
	});
	return (
		<Dialog
			{...search}
			{...props}
			onSelect={() => {
				navigated.current = true;
			}}
		>
			<SearchDialogOverlay />
			<SearchDialogContent
				onOpenAutoFocus={() => {
					previousFocus.current =
						document.activeElement instanceof HTMLElement
							? document.activeElement
							: null;
					navigated.current = false;
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (!navigated.current && previousFocus.current?.isConnected)
						previousFocus.current.focus({ preventScroll: true });
				}}
			>
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput />
					<SearchDialogClose />
				</SearchDialogHeader>
				<SearchDialogList />
			</SearchDialogContent>
		</Dialog>
	);
}
