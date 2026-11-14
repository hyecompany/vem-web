// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useSyncExternalStore } from "react";
import { stableKey } from "./descriptors.js";
import { idleReadStatus } from "./protocol.js";
import { useDataClient } from "./react-context.js";
import type { QueryDescriptor } from "./types.js";

export interface UseReadStatusOptions {
	/** False stops observation and returns an idle status. */
	enabled?: boolean;
}

/** Observe relevant reads across consumers without requesting data or grouping their queries. */
export function useReadStatus<T extends object, I>(
	query: QueryDescriptor<T, I>,
	{ enabled = true }: UseReadStatusOptions = {},
) {
	const client = useDataClient();
	const key = stableKey(query);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Equivalent inline descriptions share one observation.
	const handle = useMemo(
		() =>
			enabled
				? client.watchReadStatus(query)
				: {
						getSnapshot: () => idleReadStatus,
						subscribe: () => () => {},
						retry: async () => {},
					},
		[client, key, enabled],
	);
	const value = useSyncExternalStore(
		handle.subscribe,
		handle.getSnapshot,
		handle.getSnapshot,
	);
	return useMemo(() => ({ ...value, retry: handle.retry }), [value, handle]);
}
