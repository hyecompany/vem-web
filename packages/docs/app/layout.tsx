// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import "./global.css";
import "@hyecompany/vem-ui/styles.css";
import "./learning.css";
import "./styles/flows.css";
import "./styles/experiments.css";
import "./styles/planning.css";
import "./styles/components.css";
import type { ReactNode } from "react";
import { DocsProvider } from "@/components/DocsProvider";

export const metadata = {
	icons: {
		icon: {
			url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/branding/hye-square.png`,
			type: "image/png",
		},
	},
	title: {
		template: "%s | Hye Vem",
		default: "Hye Vem",
	},
	description:
		"Shared data and accessible interface components for browser applications.",
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
