// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { Card, CardContent } from "@hyecompany/vem-ui";
import { Demo } from "./demo";
export default function Page() {
	return (
		<main>
			<h1>Packed Vem application</h1>
			<Card>
				<CardContent>Rendered on the server.</CardContent>
			</Card>
			<Demo />
		</main>
	);
}
