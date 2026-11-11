// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const location = process.env.VEM_STARTER_DIRECTORY
	? pathToFileURL(resolve(process.env.VEM_STARTER_DIRECTORY, "dev.mjs")).href
	: new URL("../../packages/data/examples/task-board/dev.mjs", import.meta.url)
			.href;
const { startTaskBoard } = await import(location);

import { browser } from "../support/browser.mjs";
import { starterJourney } from "./support/starter-journey.mjs";

test("runnable starter acquires through one actual SharedWorker, shares tabs, and preserves conflicts", async () => {
	const engine = await browser();
	try {
		await starterJourney(startTaskBoard, engine);
	} finally {
		await engine.close();
	}
});
