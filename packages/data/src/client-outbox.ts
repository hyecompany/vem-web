// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/** Preserve a caller turn as one owner task so sibling demands reach the planner together. */
export class ClientOutbox {
	#messages: unknown[] = [];
	#scheduled = false;
	constructor(
		private readonly port: MessagePort,
		private readonly failed: (error: unknown) => void,
	) {}
	send(message: unknown): void {
		const type = (message as { type?: string }).type;
		// Mutations use postMessage's immediate snapshot without cloning their payload twice.
		if (type === "run" || type === "save-edit") {
			this.#messages.push(message);
			this.flush();
			return;
		}
		try {
			this.#messages.push(structuredClone(message));
		} catch (error) {
			this.failed(error);
			return;
		}
		if (this.#scheduled) return;
		this.#scheduled = true;
		queueMicrotask(() => {
			this.#scheduled = false;
			this.flush();
		});
	}
	flush(): void {
		if (!this.#messages.length) return;
		const messages = this.#messages;
		this.#messages = [];
		try {
			this.port.postMessage(
				messages.length === 1 ? messages[0] : { type: "batch", messages },
			);
		} catch (error) {
			this.failed(error);
		}
	}
	clear(): void {
		this.#messages = [];
	}
}
