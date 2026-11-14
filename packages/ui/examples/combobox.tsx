// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@hyecompany/vem-ui";
import { useId, useState } from "react";

const boards = ["Weekend", "Work", "São Paulo"];

export function ComboboxExample() {
	const id = useId();
	const [board, setBoard] = useState<string | null>("Weekend");
	return (
		<div style={{ maxWidth: "20rem" }}>
			<label htmlFor={id}>Choose a board</label>
			<Combobox items={boards} value={board} onValueChange={setBoard}>
				<ComboboxInput id={id} placeholder="Search boards…" />
				<ComboboxContent>
					<ComboboxEmpty>No matching boards.</ComboboxEmpty>
					<ComboboxList>
						{(item: string) => (
							<ComboboxItem key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</div>
	);
}
// #endregion example
