// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Button, createToastManager, Toaster } from "@hyecompany/vem-ui";
import { useState } from "react";

export function ToastExample() {
	const [manager] = useState(() => createToastManager());
	return (
		<Toaster toastManager={manager}>
			<Button
				onClick={() =>
					manager.add({
						title: "Task saved",
						description: "Your changes are ready.",
						type: "success",
					})
				}
			>
				Save task
			</Button>
		</Toaster>
	);
}
// #endregion example
