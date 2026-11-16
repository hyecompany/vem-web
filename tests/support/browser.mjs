// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { join } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";

const engines = { chromium, firefox, webkit };

function engineName() {
	const name = process.env.VEM_BROWSER ?? "chromium";
	if (!Object.hasOwn(engines, name))
		throw new Error("VEM_BROWSER must name chromium, firefox, or webkit");
	return name;
}

export function browserCacheDirectory(root) {
	return join(root, "node_modules", `.vite-${engineName()}`);
}

export async function browser() {
	const engine = engines[engineName()];
	return engine.launch({
		headless: true,
		...(process.env.VEM_BROWSER_CHANNEL
			? { channel: process.env.VEM_BROWSER_CHANNEL }
			: {}),
	});
}
