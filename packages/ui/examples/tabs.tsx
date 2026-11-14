// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hyecompany/vem-ui";

export function TabsExample() {
	return (
		<Tabs defaultValue="todo">
			<TabsList activateOnFocus aria-label="Tasks">
				<TabsTrigger value="todo">To do</TabsTrigger>
				<TabsTrigger value="done">Done</TabsTrigger>
			</TabsList>
			<TabsContent value="todo">Plan a weekend walk</TabsContent>
			<TabsContent value="done">Check the forecast</TabsContent>
		</Tabs>
	);
}
// #endregion example
