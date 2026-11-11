// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import {
	attachBackgroundTransfers,
	connectSharedWorker,
} from "@hyecompany/vem-data/client";
import { channel, compatibility } from "./config.js";
import ownerUrl from "./owner.ts?worker&url";

const detach = attachBackgroundTransfers({
	serviceWorker: "/transfers.js",
	scope: "/",
	channel,
});
const client = connectSharedWorker(
	new URL(ownerUrl, location.href),
	compatibility,
);
Object.assign(window, {
	fixture: {
		client,
		run(size: number) {
			const handle = client.run({
				kind: "command",
				resource: "files",
				name: "upload",
				input: new Blob([new Uint8Array(size)]),
				target: "file",
			});
			Object.assign(window, { transferHandle: handle });
			return handle.id;
		},
	},
});
window.addEventListener("pagehide", (event) => {
	if (!event.persisted) {
		detach();
		client.close();
	}
});
