// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxVirtualList,
} from "@hyecompany/vem-ui";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@hyecompany/vem-ui/styles.css";

const original = Array.from({ length: 1000 }, (_, index) => ({
	id: String(index),
	name: `Project ${String(index).padStart(4, "0")}`,
}));
const active = new Set<string>();
declare global {
	interface Window {
		activeDescriptions: Set<string>;
		seenDescriptions: Set<string>;
		descriptionBatches: string[][];
		setDescription: (description: string) => void;
		setProjects: (items: typeof original) => void;
		setVirtualStatus: (status: string) => void;
	}
}
window.activeDescriptions = active;
window.seenDescriptions = new Set();
window.descriptionBatches = [];
let batch: string[] | undefined;
function recordDescription(id: string) {
	if (!batch) {
		batch = [];
		queueMicrotask(() => {
			if (batch) window.descriptionBatches.push(batch);
			batch = undefined;
		});
	}
	batch.push(id);
}
function Description({ id, description }: { id: string; description: string }) {
	useEffect(() => {
		active.add(id);
		recordDescription(id);
		window.seenDescriptions.add(id);
		return () => {
			active.delete(id);
		};
	}, [id]);
	return description ? (
		<small style={{ display: "block", lineHeight: "24px" }}>
			{description}
		</small>
	) : null;
}
function App() {
	const [items, setItems] = useState(original);
	const [open, setOpen] = useState(true);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<(typeof original)[number] | null>(
		new URLSearchParams(location.search).has("selected")
			? (original[999] ?? null)
			: null,
	);
	const [description, setDescription] = useState("");
	const [status, setStatus] = useState("");
	window.setVirtualStatus = setStatus;
	window.setDescription = setDescription;
	window.setProjects = setItems;
	return (
		<main style={{ maxWidth: "320px" }}>
			<Combobox
				virtualized
				items={open ? items : selected ? [selected] : []}
				filteredItems={
					open
						? items.filter((item) =>
								item.name.toLowerCase().includes(search.toLowerCase()),
							)
						: selected
							? [selected]
							: []
				}
				filter={null}
				inputValue={open ? search : (selected?.name ?? "")}
				onInputValueChange={(text, details) => {
					if (
						details.reason === "input-change" ||
						details.reason === "input-clear"
					)
						setSearch(text);
				}}
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) setSearch("");
				}}
				itemToStringLabel={(item) => item.name}
				isItemEqualToValue={(left, right) => left.id === right.id}
				value={selected}
				onValueChange={setSelected}
				autoHighlight={false}
			>
				<ComboboxInput aria-label="Project" />
				<ComboboxContent style={{ display: "flex", flexDirection: "column" }}>
					{status && <output style={{ padding: 12 }}>{status}</output>}
					{open && (
						<ComboboxVirtualList<(typeof original)[number]>
							getItemKey={(item) => item.id}
							overscan={0}
							style={{ maxHeight: "240px", minHeight: 0, flexShrink: 1 }}
						>
							{(item, { visible }) => (
								<ComboboxItem
									value={item}
									data-project={item.id}
									data-visible={visible}
								>
									<span>
										{item.name}
										{visible && (
											<Description id={item.id} description={description} />
										)}
									</span>
								</ComboboxItem>
							)}
						</ComboboxVirtualList>
					)}
				</ComboboxContent>
			</Combobox>
			<output aria-label="Selection">{selected?.name ?? "none"}</output>
		</main>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
