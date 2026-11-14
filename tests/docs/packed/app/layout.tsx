// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import "@hyecompany/vem-ui/styles.css";
import type { ReactNode } from "react";
export const metadata = {
	icons: {
		icon: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E",
	},
};
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark">
			<body>{children}</body>
		</html>
	);
}
