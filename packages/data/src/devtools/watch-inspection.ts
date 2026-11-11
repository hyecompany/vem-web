// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { Watch } from "../types.js";

export function inspectWatch<T>(
	handle: Watch<T>,
	attach: (read: () => T) => () => void,
): Watch<T> & { dispose(): void } {
	const releases = new Set<() => void>();
	return {
		getSnapshot: handle.getSnapshot,
		subscribe(listener) {
			const stop = handle.subscribe(listener);
			const detach = attach(handle.getSnapshot);
			const release = () => {
				if (!releases.delete(release)) return;
				detach();
				stop();
			};
			releases.add(release);
			return release;
		},
		dispose() {
			for (const release of releases) release();
			handle.dispose?.();
		},
	};
}
