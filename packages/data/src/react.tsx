// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useSyncExternalStore,
} from "react";
import { commandKey, stableKey } from "./descriptors.js";
import { EditSession } from "./edit.js";
import type {
	ActionHandle,
	ActionOutcome,
	ActionSnapshot,
	CommandDescriptor,
	DataClient,
	EditDescriptor,
	QueryDescriptor,
	QueryResult,
} from "./types.js";

const ClientContext = createContext<DataClient | null>(null);
/** Install one consumer client for descendant hooks. The application host owns the client lifetime. */
export function DataProvider({
	client,
	children,
}: {
	client: DataClient;
	children: ReactNode;
}) {
	return (
		<ClientContext.Provider value={client}>{children}</ClientContext.Provider>
	);
}
/** Return the provider client; throws when no DataProvider is installed. */
export function useDataClient(): DataClient {
	const client = useContext(ClientContext);
	if (!client)
		throw new Error(
			"Install DataProvider at the application root before using Vem Data",
		);
	return client;
}
/** Subscribe to selected information. Equivalent inline descriptions share value-based identity; retry belongs to the returned result. */
export function useQuery<T extends object, I>(
	descriptor: QueryDescriptor<T, I>,
) {
	const client = useDataClient();
	const key = stableKey(descriptor);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The value key makes equivalent inline descriptions share one subscription.
	const binding = useMemo(
		() => ({ handle: client.watch(descriptor), query: descriptor }),
		[client, key],
	);
	const { handle } = binding;
	const value = useSyncExternalStore(
		handle.subscribe,
		handle.getSnapshot,
		handle.getSnapshot,
	);
	return useMemo(
		() => ({ ...value, retry: binding.handle.retry, query: binding.query }),
		[value, binding],
	);
}
/** Observe current admission and return run. Unknown authorization permits an attempt; execution rechecks admission. */
export function useCommand<I, O extends ActionOutcome>(
	descriptor: CommandDescriptor<I, O>,
) {
	const client = useDataClient();
	const key = commandKey(descriptor);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The command key includes transfer identity and all admission inputs.
	const handle = useMemo(
		() => client.watchAvailability(descriptor as CommandDescriptor),
		[client, key],
	);
	const availability = useSyncExternalStore(
		handle.subscribe,
		handle.getSnapshot,
		handle.getSnapshot,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Equivalent command values intentionally keep the same run binding.
	return useMemo(
		() => ({
			availability,
			canRun:
				availability.state === "available" || availability.state === "unknown",
			run: () => client.run(descriptor),
		}),
		[client, key, availability],
	);
}
/** Observe shared action records visible under the current disclosure context. */
export function useActivities(): readonly ActionSnapshot[] {
	const client = useDataClient();
	const handle = useMemo(
		() => ({
			subscribe: (listener: () => void) => client.subscribeActivities(listener),
			snapshot: () => client.listActivities(),
		}),
		[client],
	);
	return useSyncExternalStore(
		handle.subscribe,
		handle.snapshot,
		handle.snapshot,
	);
}
/** Observe the progress and outcome of an action handle without changing execution. */
export function useAction<O extends ActionOutcome>(action: ActionHandle<O>) {
	return useSyncExternalStore(
		action.subscribe,
		action.getSnapshot,
		action.getSnapshot,
	);
}
/** Manage baseline, ETag, protected draft, save activity, and conflict outcomes; layout and validation remain with the component. */
export function useEdit<
	T extends object,
	O extends ActionOutcome = ActionOutcome,
>(descriptor: EditDescriptor<T, unknown, O>) {
	const client = useDataClient();
	const key = stableKey(descriptor);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Equivalent inline edit descriptions must retain the same managed draft.
	const session = useMemo(
		() => new EditSession(client, descriptor),
		[client, key],
	);
	const value = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	return useMemo(
		() => ({
			...value,
			set: session.set.bind(session),
			save: session.save.bind(session),
			reload: session.reload.bind(session),
		}),
		[value, session],
	);
}
/** Choose ordinary presentation with permitted content or prior evidence first; unresolved candidates still need an explicit unconfirmed label. */
export function queryView<T extends object, I>(result: QueryResult<T, I>) {
	if (result.rows.length > 0 || result.unresolved.length > 0 || result.stale)
		return "content" as const;
	if (result.empty) return "empty" as const;
	if (result.issues.some((issue) => issue.kind === "access"))
		return "restricted" as const;
	if (result.fetching || !result.settled) return "loading" as const;
	if (result.issues.length > 0) return "error" as const;
	return "incomplete" as const;
}

export type { EditSnapshot } from "./edit.js";
