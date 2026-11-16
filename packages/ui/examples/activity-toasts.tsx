// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { createToastManager, Toaster } from "@hyecompany/vem-ui";
import { ActivityToasts } from "@hyecompany/vem-ui/data";
import { type ReactNode, useState } from "react";

export function FeedbackHost({ children }: { children: ReactNode }) {
	const [manager] = useState(() => createToastManager());
	return (
		<Toaster toastManager={manager}>
			{children}
			<ActivityToasts />
		</Toaster>
	);
}
// #endregion example
