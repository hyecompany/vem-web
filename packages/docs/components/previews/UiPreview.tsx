// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import {
	Button,
	OverflowText,
	Spinner,
	type SpinnerProps,
} from "@hyecompany/vem-ui";

import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import previews from "@/content/ui-previews.json";

function OverflowPreview() {
	const [wide, setWide] = useState(false);
	const name = "Research · São Paulo · shared development";
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<Button
					variant="outline"
					data-vem-overflow-trigger=""
					style={{
						width: wide ? "min(100%, 22rem)" : "12rem",
						justifyContent: "flex-start",
					}}
					aria-label={name}
				>
					<FolderOpen aria-hidden="true" />
					<OverflowText text={name} />
				</Button>
				<Button variant="ghost" size="sm" onClick={() => setWide(!wide)}>
					{wide ? "Narrow control" : "Widen control"}
				</Button>
			</div>
			<p className="m-0 text-sm text-muted-foreground">{name}</p>
		</div>
	);
}

function SpinnerPreview() {
	const [size, setSize] = useState<SpinnerProps["size"]>("md");
	const [loading, setLoading] = useState(false);
	const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timeout.current), []);
	return (
		<div className="flex flex-wrap items-center gap-4">
			<fieldset className="flex gap-1" aria-label="Spinner size">
				{(["sm", "md", "lg"] as const).map((value) => (
					<Button
						key={value}
						size="sm"
						variant={size === value ? "outline" : "ghost"}
						aria-pressed={size === value}
						onClick={() => setSize(value)}
					>
						{value === "sm" ? "Small" : value === "md" ? "Medium" : "Large"}
					</Button>
				))}
			</fieldset>
			<Button
				variant="outline"
				disabled={loading}
				className="disabled:opacity-100"
				onClick={() => {
					setLoading(true);
					timeout.current = setTimeout(() => setLoading(false), 1200);
				}}
			>
				{loading && <Spinner size={size} aria-hidden="true" />}
				{loading ? "Loading tasks…" : "Load tasks"}
			</Button>
			<span className="sr-only" aria-live="polite">
				{loading ? "Loading tasks" : ""}
			</span>
		</div>
	);
}

export function UiPreview({ name }: { name: keyof typeof previews }) {
	const preview = previews[name];
	return (
		<figure
			className="not-prose my-6 space-y-4 rounded-xl border bg-card p-5"
			aria-label={preview.title}
		>
			{name === "overflow" ? <OverflowPreview /> : <SpinnerPreview />}
			<figcaption className="text-sm leading-relaxed text-muted-foreground">
				{preview.explanation}
			</figcaption>
		</figure>
	);
}
