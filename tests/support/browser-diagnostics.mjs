// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function startBrowserDiagnostics(page) {
	await page
		.context()
		.tracing.start({ screenshots: true, snapshots: true, sources: true });
	await page.addInitScript(() => {
		window.browserMotionEvents = [];
		window.browserFrameState = {
			requested: 0,
			delivered: 0,
			lastDelivered: null,
		};
		const requestFrame = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (callback) => {
			window.browserFrameState.requested++;
			return requestFrame((time) => {
				window.browserFrameState.delivered++;
				window.browserFrameState.lastDelivered = performance.now();
				callback.call(window, time);
			});
		};
		for (const type of [
			"transitionrun",
			"transitionend",
			"transitioncancel",
			"animationstart",
			"animationend",
			"animationcancel",
		]) {
			document.addEventListener(
				type,
				(event) => {
					window.browserMotionEvents.push({
						type,
						time: performance.now(),
						slot: event.target?.getAttribute?.("data-slot"),
						property: event.propertyName,
						animation: event.animationName,
					});
					if (window.browserMotionEvents.length > 100)
						window.browserMotionEvents.shift();
				},
				true,
			);
		}
	});
}

export async function withBrowserDiagnostics(page, assertion) {
	try {
		return await assertion();
	} catch (error) {
		const directory = new URL(
			`../../.artifacts/browser/${process.env.VEM_BROWSER ?? "chromium"}/${randomUUID()}/`,
			import.meta.url,
		);
		await mkdir(directory, { recursive: true });
		const results = await Promise.allSettled([
			page
				.evaluate(() => ({
					visibility: document.visibilityState,
					now: performance.now(),
					frames: window.browserFrameState,
					focus: document.activeElement?.outerHTML,
					events: window.browserMotionEvents,
					elements: [
						...document.querySelectorAll("[data-ending-style], [data-closed]"),
					].map((node) => ({
						html: node.outerHTML,
						opacity: getComputedStyle(node).opacity,
						translate: getComputedStyle(node).translate,
						animations: node.getAnimations().map((animation) => ({
							state: animation.playState,
							pending: animation.pending,
							time: animation.currentTime,
							timing: animation.effect?.getComputedTiming(),
							frames: animation.effect?.getKeyframes(),
						})),
					})),
				}))
				.then(async (state) => {
					await writeFile(
						new URL("state.json", directory),
						JSON.stringify(state, null, 2),
					);
					console.error(`Dismissal state: ${JSON.stringify(state)}`);
				}),
			page.screenshot({
				path: fileURLToPath(new URL("page.png", directory)),
				timeout: 5000,
			}),
			page
				.context()
				.tracing.stop({ path: fileURLToPath(new URL("trace.zip", directory)) }),
		]);
		console.error(`Browser diagnostics: ${fileURLToPath(directory)}`);
		for (const result of results)
			if (result.status === "rejected")
				console.error("Could not capture diagnostic:", result.reason);
		throw error;
	}
}
