// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { DataClient } from "@hyecompany/vem-data";
import { useDataClient } from "@hyecompany/vem-data/react";
import { useRef, useState } from "react";
import {
	ActivityPresentation,
	type ActivityPresentationProps,
} from "./activity-presentation.js";

/** Shared controls resolve their authority from the current action ID, never a retained command or original handle. */
export function ManagedActivity(
	props: ActivityPresentationProps & { onRetryAccepted?(): void },
) {
	const {
		action: { id },
		onCancel,
		onRetry,
		onRetryAccepted,
	} = props;
	const client = useDataClient();
	const pending = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const execute = async (kind: "cancel" | "retry") => {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		setError(undefined);
		try {
			const override = kind === "cancel" ? onCancel : onRetry;
			if (override) await override();
			else await nativeControl(client, id, kind, onRetryAccepted);
		} catch {
			setError(
				kind === "cancel"
					? "Cancellation could not be requested. Check the current activity before trying again."
					: "A retry could not be started. Check the current activity before trying again.",
			);
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};
	return (
		<ActivityPresentation
			{...props}
			controlsBusy={busy}
			controlError={error}
			onCancel={() => {
				void execute("cancel");
			}}
			onRetry={() => {
				void execute("retry");
			}}
		/>
	);
}

async function nativeControl(
	client: DataClient,
	id: string,
	kind: "cancel" | "retry",
	onRetryAccepted?: () => void,
) {
	if (kind === "cancel") return client.action(id).cancel();
	const attempt = client.action(id).retry();
	const observed = client.action(attempt.id);
	let accepted = false;
	let release = () => {};
	const check = () => {
		if (accepted || observed.getSnapshot() === undefined) return;
		accepted = true;
		release();
		onRetryAccepted?.();
	};
	release = observed.subscribe(check);
	if (accepted) release();
	else check();
	try {
		await attempt.result;
	} finally {
		release();
	}
}
