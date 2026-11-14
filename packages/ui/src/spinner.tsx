// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ComponentProps } from "react";

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
/** A decorative or labelled activity indicator; inherits the surrounding text color. */
export type SpinnerProps = Omit<ComponentProps<"span">, "children"> & {
	/** Render at 1rem, 1.5rem, or 2rem. Defaults to md. */
	size?: "sm" | "md" | "lg";
};

/** Use aria-hidden with nearby status text, or supply a meaningful aria-label. */
export function Spinner({
	size = "md",
	className,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	"aria-hidden": ariaHidden,
	...props
}: SpinnerProps) {
	const hidden = ariaHidden === true || ariaHidden === "true";
	return (
		// biome-ignore lint/a11y/useSemanticElements: This reports activity, not the result of a calculation.
		<span
			role="status"
			data-vem-spinner=""
			data-size={size}
			aria-hidden={ariaHidden}
			aria-label={
				ariaLabel ?? (hidden || ariaLabelledBy ? undefined : "Loading")
			}
			aria-labelledby={ariaLabelledBy}
			className={["vem-spinner", className].filter(Boolean).join(" ")}
			{...props}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="currentColor"
				style={{ inlineSize: "100%", blockSize: "100%" }}
			>
				{[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
					<rect
						key={angle}
						x="10.5"
						y="0"
						width="3"
						height="7.2"
						rx="1.5"
						opacity={(angle / 45 + 1) / 8}
						style={{ animationDelay: `${-(7 - angle / 45) * 100}ms` }}
						transform={`rotate(${angle} 12 12)`}
					/>
				))}
			</svg>
		</span>
	);
}
// SPDX-SnippetEnd
