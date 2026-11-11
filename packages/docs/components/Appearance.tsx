// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
export function Appearance() {
	return (
		<div className="docs-appearance">
			<span>Appearance</span>
			<ThemeSwitch mode="light-dark-system" />
		</div>
	);
}
