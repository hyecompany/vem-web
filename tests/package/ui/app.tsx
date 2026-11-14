// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	OverflowText,
	Spinner,
} from "@hyecompany/vem-ui";
import { useEffect, useState } from "react";
import "@hyecompany/vem-ui/styles.css";

export const label = "Quarterly 👩🏽‍🚀 café research report 🇺🇳 final.pdf";
export function App() {
	const [saved, setSaved] = useState(false);
	const [board, setBoard] = useState<string | null>("Weekend");
	const [width, setWidth] = useState(190);
	const [spacing, setSpacing] = useState(0);
	const [highlighted, setHighlighted] = useState(false);
	const [popupOpen, setPopupOpen] = useState(false);
	const [openingFinished, setOpeningFinished] = useState(false);
	useEffect(() => {
		document.documentElement.dataset.hydrated = "true";
	}, []);
	return (
		<main>
			<h1>Portable Vem UI</h1>
			<section
				aria-label="Standard components"
				style={{ display: "grid", gap: "1rem", maxWidth: "22rem" }}
			>
				<Button className="border-b" onClick={() => setSaved(true)}>
					Save task
				</Button>
				<output>{saved ? "Task saved" : "Ready"}</output>
				<Button className="border" variant="outline">
					Host styled control
				</Button>
				<Combobox
					items={["Weekend", "Work"]}
					value={board}
					onValueChange={setBoard}
				>
					<ComboboxInput aria-label="Board" />
					<ComboboxContent>
						<ComboboxList>
							{(item: string) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</section>
			<p>Read the full file name below without waiting for motion.</p>
			<p data-testid="full-name">{label}</p>
			<div style={{ display: "flex", gap: 24, alignItems: "center" }}>
				<button
					type="button"
					data-testid="parent"
					data-vem-overflow-trigger=""
					data-highlighted={highlighted || undefined}
					style={{
						width,
						font: "inherit",
						padding: 12,
						letterSpacing: spacing,
					}}
				>
					<OverflowText text={label} />
				</button>
				<Spinner size="sm" aria-label="Saving changes" />
				<Spinner aria-hidden />
				<button type="button">
					<Spinner size="lg" aria-hidden /> Connect
				</button>
			</div>
			<div dir="rtl" style={{ width: 180, marginTop: 24 }} data-testid="rtl">
				<OverflowText text="اسم المشروع الطويل للاختبار في الاتجاه العربي" />
			</div>
			<p>
				<button
					type="button"
					onClick={() => setWidth(width === 190 ? 1000 : 190)}
				>
					Resize
				</button>
			</p>
			<p>
				<button type="button" onClick={() => setSpacing(spacing ? 0 : 3)}>
					Change letter spacing
				</button>
			</p>
			<p>
				<button type="button" onClick={() => setHighlighted(!highlighted)}>
					Highlight item
				</button>
			</p>
			<p>
				<button
					type="button"
					onClick={() => {
						setPopupOpen(true);
						setOpeningFinished(false);
					}}
				>
					Open scaled popup
				</button>
			</p>
			{popupOpen && (
				<div
					data-testid="scaled-popup"
					style={{
						width: 190,
						transform: openingFinished ? "scale(1)" : "scale(0.85)",
						transformOrigin: "top left",
						transition: "transform 200ms",
					}}
				>
					<OverflowText text={label} />
				</div>
			)}
			<p>
				<button type="button" onClick={() => setOpeningFinished(true)}>
					Finish opening
				</button>
			</p>
		</main>
	);
}
