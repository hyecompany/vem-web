// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@hyecompany/vem-ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@hyecompany/vem-ui/styles.css";

declare global {
	interface Window {
		updateChoices(items: string[]): void;
		setStatus(message: string): void;
		readListRef(): string | null | undefined;
	}
}
const manual = new URLSearchParams(location.search).has("manual");
function App() {
	const [items, setItems] = useState(["Alpha", "Bravo", "Charlie"]);
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState("");
	const [choice, setChoice] = useState<string | null>(null);
	const [open, setOpen] = useState(true);
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => {
		window.updateChoices = setItems;
		window.setStatus = setStatus;
		window.readListRef = () => list.current?.getAttribute("data-custom-list");
	}, []);
	const options = items.filter((item) =>
		item.toLowerCase().includes(search.toLowerCase()),
	);
	return (
		<>
			<h1>Combobox motion</h1>
			<Combobox
				items={manual ? undefined : items}
				filter={manual ? null : undefined}
				value={choice}
				onValueChange={setChoice}
				open={open}
				onOpenChange={setOpen}
				inputValue={search}
				onInputValueChange={setSearch}
				autoHighlight={false}
			>
				<ComboboxInput aria-label="Project" />
				<ComboboxContent>
					{status && (
						<output
							aria-label="Read status"
							style={{ display: "block", padding: "12px" }}
						>
							{status}
						</output>
					)}
					<ComboboxList
						ref={list}
						aria-label="Projects"
						render={<div data-custom-list="preserved" />}
					>
						{manual
							? options.map((item) => (
									<ComboboxItem key={item} value={item}>
										{item}
									</ComboboxItem>
								))
							: (item: string) => (
									<ComboboxItem key={item} value={item}>
										{item}
									</ComboboxItem>
								)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			<output aria-label="Selection">{choice ?? "none"}</output>
		</>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
