// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import "./global.css";
import "./learning.css";
import "./styles/flows.css";
import "./styles/experiments.css";
import "./styles/planning.css";
import type { ReactNode } from "react";
import { DocsProvider } from "@/components/DocsProvider";

export const metadata = {
	title: {
		template: "%s | Hye Vem",
		default: "Hye Vem",
	},
	description:
		"Build browser features with shared data, coordinated actions, and protected edits.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="flex min-h-screen flex-col">
				<DocsProvider>{children}</DocsProvider>
			</body>
		</html>
	);
}
