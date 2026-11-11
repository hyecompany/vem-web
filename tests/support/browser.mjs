// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { chromium, firefox, webkit } from "@playwright/test";

export async function browser() {
	const engine = { chromium, firefox, webkit }[
		process.env.VEM_BROWSER ?? "chromium"
	];
	if (!engine)
		throw new Error("VEM_BROWSER must name chromium, firefox, or webkit");
	return engine.launch({
		headless: true,
		...(process.env.VEM_BROWSER_CHANNEL
			? { channel: process.env.VEM_BROWSER_CHANNEL }
			: {}),
	});
}
