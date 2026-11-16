// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxVirtualList,
} from "@hyecompany/vem-ui";

interface Board {
	id: string;
	name: string;
}
export function LargeBoardSelector({ boards }: { boards: readonly Board[] }) {
	return (
		<Combobox
			virtualized
			items={boards}
			itemToStringLabel={(board: Board) => board.name}
			isItemEqualToValue={(left, right) => left.id === right.id}
		>
			<ComboboxInput aria-label="Board" placeholder="Search boards…" />
			<ComboboxContent>
				<ComboboxEmpty>No matching boards.</ComboboxEmpty>
				<ComboboxVirtualList<Board> getItemKey={(board) => board.id}>
					{(board) => <ComboboxItem value={board}>{board.name}</ComboboxItem>}
				</ComboboxVirtualList>
			</ComboboxContent>
		</Combobox>
	);
}
// #endregion example
