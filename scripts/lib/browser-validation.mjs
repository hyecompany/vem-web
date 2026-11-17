// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

export function browserValidationTasks(runBrowser) {
	const engines = ["chromium", "firefox", "webkit"];
	return {
		...Object.fromEntries(
			engines.map((engine) => [
				`browser:${engine}`,
				{ needs: ["build:ui"], run: () => runBrowser(engine) },
			]),
		),
		"browser:all": { needs: engines.map((engine) => `browser:${engine}`) },
	};
}
