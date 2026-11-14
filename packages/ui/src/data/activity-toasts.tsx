// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ActionSnapshot, FeedbackObservation } from "@hyecompany/vem-data";
import { useDataClient, useFeedback } from "@hyecompany/vem-data/react";
import {
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { useToastManager } from "../toast.js";
import { ManagedActivity } from "./managed-activity.js";

export interface ActivityToastsProps {
	label?(action: ActionSnapshot): ReactNode;
}
/** Project assigned feedback into the toast host without copying protected activity details into toast state. */
export function ActivityToasts({ label }: ActivityToastsProps) {
	const { activities, acknowledge } = useFeedback(),
		{ add, update, close } = useToastManager();
	const displayed = useRef(new Set<string>());
	useEffect(() => {
		const previous = displayed.current;
		const current = new Set(
			activities.map((action) => `vem-action:${action.id}`),
		);
		displayed.current = current;
		for (const action of activities) {
			const id = `vem-action:${action.id}`,
				actionId = action.id;
			const outcome = action.outcome?.kind;
			const observed: FeedbackObservation = {
				phase: action.phase,
				outcome: outcome ? { kind: outcome } : undefined,
			};
			const input = {
				title: (
					<LiveActivity
						id={actionId}
						label={label}
						onRetryAccepted={acknowledgeAfterRetry(
							acknowledge,
							actionId,
							observed,
						)}
					/>
				),
				type:
					outcome === "succeeded"
						? ("success" as const)
						: outcome === "failed"
							? ("error" as const)
							: outcome === "unknown" || outcome === "partial"
								? ("warning" as const)
								: ("info" as const),
				timeout: outcome === "succeeded" ? 5000 : 0,
				onClose: () => {
					if (displayed.current.delete(id)) acknowledge(actionId, observed);
				},
			};
			if (previous.has(id))
				update(id, (toast) => {
					const { timeout, ...rest } = input;
					return toast.timeout === timeout ? rest : input;
				});
			else add({ id, ...input });
		}
		for (const id of previous) if (!current.has(id)) close(id);
	}, [activities, acknowledge, add, update, close, label]);
	useEffect(
		() => () => {
			const previous = displayed.current;
			displayed.current = new Set();
			for (const id of previous) close(id);
		},
		[close],
	);
	return null;
}
function LiveActivity({
	id,
	label,
	onRetryAccepted,
}: {
	id: string;
	label?: ActivityToastsProps["label"];
	onRetryAccepted(): void;
}) {
	const client = useDataClient();
	const handle = useMemo(() => client.action(id), [client, id]);
	const action = useSyncExternalStore(
		handle.subscribe,
		handle.getSnapshot,
		() => undefined,
	);
	return action ? (
		<ManagedActivity
			onRetryAccepted={onRetryAccepted}
			announce={false}
			action={action}
			label={label?.(action) ?? action.name}
		/>
	) : null;
}

function acknowledgeAfterRetry(
	acknowledge: (id: string, observed?: FeedbackObservation) => void,
	id: string,
	observed: FeedbackObservation,
) {
	return () => acknowledge(id, observed);
}
