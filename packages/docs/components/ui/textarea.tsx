// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-FileCopyrightText: 2023 shadcn
// SPDX-License-Identifier: MIT
// Adapted for the Hye Vem documentation.

import type * as React from "react";
import { cn } from "@/lib/utils";
export function Textarea({
	className,
	...props
}: React.ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
