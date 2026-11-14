// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@hyecompany/vem-ui";

export function CardExample() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h3>Weekend plans</h3>
				</CardTitle>
				<CardDescription>A little time outdoors.</CardDescription>
			</CardHeader>
			<CardContent>Plan a walk and pack a picnic.</CardContent>
		</Card>
	);
}
// #endregion example
