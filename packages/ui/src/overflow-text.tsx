// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
	type ComponentProps,
	type CSSProperties,
	useEffect,
	useRef,
	useState,
} from "react";
import { measureOverflow } from "./measure-overflow.js";

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
/** A single-line label with grapheme-safe middle truncation and optional motion. */
export type OverflowTextProps = Omit<ComponentProps<"span">, "children"> & {
	/** Complete text, retained for assistive technology even when visually truncated. */
	text: string;
};

/** Mark the interactive parent with data-vem-overflow-trigger to reveal on its activation. */
export function OverflowText({
	text,
	className,
	style,
	dir = "auto",
	title,
	ref,
	...props
}: OverflowTextProps) {
	const container = useRef<HTMLSpanElement>(null);
	const measure = useRef<HTMLSpanElement>(null);
	const candidate = useRef<HTMLSpanElement>(null);
	const [layout, setLayout] = useState({
		source: text,
		overflow: false,
		truncated: text,
		width: 0,
	});
	useEffect(() => {
		const element = container.current;
		const full = measure.current;
		const sample = candidate.current;
		if (!element || !full || !sample) return;
		let frame = 0;
		let active = true;
		const update = () => {
			if (!active) return;
			const next = measureOverflow(text, element, full, sample);
			setLayout((current) =>
				current.source === next.source &&
				current.overflow === next.overflow &&
				current.truncated === next.truncated &&
				current.width === next.width
					? current
					: next,
			);
		};
		const schedule = () => {
			if (!active) return;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(update);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(element);
		observer.observe(full);
		document.fonts.addEventListener("loadingdone", schedule);
		void document.fonts.ready.then(schedule);
		update();
		return () => {
			active = false;
			observer.disconnect();
			document.fonts.removeEventListener("loadingdone", schedule);
			cancelAnimationFrame(frame);
		};
	}, [text]);
	const overflow = layout.source === text && layout.overflow;
	return (
		<span
			{...props}
			ref={(node) => {
				container.current = node;
				if (typeof ref === "function") return ref(node);
				if (ref) ref.current = node;
			}}
			dir={dir}
			className={["vem-overflow", className].filter(Boolean).join(" ")}
			data-vem-overflow={overflow || undefined}
			title={title ?? (overflow ? text : undefined)}
			style={
				{
					"--vem-overflow-duration": `${(layout.width + 24) / 35}s`,
					...style,
				} as CSSProperties
			}
		>
			<span className="vem-sr-only">{text}</span>
			<span ref={measure} aria-hidden="true" className="vem-overflow-measure">
				{text}
			</span>
			<span
				ref={candidate}
				aria-hidden="true"
				className="vem-overflow-candidate"
			/>
			<span aria-hidden="true" className="vem-overflow-rest">
				{overflow ? layout.truncated : text}
			</span>
			{overflow && (
				<span aria-hidden="true" className="vem-overflow-viewport">
					<span className="vem-overflow-track">
						<span>{text}</span>
						<span>{text}</span>
					</span>
				</span>
			)}
		</span>
	);
}
// SPDX-SnippetEnd
