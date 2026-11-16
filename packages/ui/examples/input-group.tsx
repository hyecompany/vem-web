// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@hyecompany/vem-ui";
import { useId } from "react";
export function InputGroupExample() {
	const id = useId();
	return (
		<div style={{ maxWidth: "22rem" }}>
			<label htmlFor={id}>Board address</label>
			<InputGroup>
				<InputGroupAddon>
					<InputGroupText>tasks.example/</InputGroupText>
				</InputGroupAddon>
				<InputGroupInput id={id} defaultValue="weekend" />
			</InputGroup>
		</div>
	);
}
// #endregion example
