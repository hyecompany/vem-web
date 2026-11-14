// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ActionSnapshot } from "@hyecompany/vem-data";
import type { ReactNode } from "react";
import { Button } from "../button.js";

export interface ActivityPresentationProps {
	action: ActionSnapshot;
	label?: ReactNode;
	className?: string;
	announce?: boolean;
	controlsBusy?: boolean;
	controlError?: string;
	onCancel?(): void | Promise<void>;
	onRetry?(): void | Promise<void>;
}
/** Present evidence-supported progress or outcome. Cancel and retry appear only when explicitly bound and admitted. */
export function ActivityPresentation({
	action,
	label,
	className,
	announce = true,
	controlsBusy = false,
	controlError,
	onCancel,
	onRetry,
}: ActivityPresentationProps) {
	const outcome = action.outcome;
	const message =
		action.phase !== "settled"
			? (action.progress?.message ??
				(action.phase === "recovering"
					? "Checking the outcome…"
					: "In progress…"))
			: outcome?.kind === "failed"
				? outcome.error.message
				: outcome?.kind === "unknown"
					? outcome.message
					: outcome?.kind === "partial"
						? (outcome.message ?? "Some changes were applied.")
						: outcome?.kind === "succeeded"
							? "Completed."
							: "The outcome is unavailable.";
	const progress = action.progress;
	const Element = announce ? "output" : "span";
	return (
		<Element
			className={className}
			data-vem-activity=""
			data-outcome={outcome?.kind}
		>
			{label && <strong>{label}</strong>}
			<span>{message}</span>
			{action.phase !== "settled" &&
				progress?.total !== undefined &&
				progress.total > 0 && (
					<progress
						aria-label="Progress"
						max={progress.total}
						value={progress.completed}
					/>
				)}
			{onCancel && action.controls.canCancel && (
				<Button
					size="sm"
					variant="ghost"
					disabled={controlsBusy}
					aria-busy={controlsBusy}
					onClick={onCancel}
				>
					Cancel
				</Button>
			)}
			{onRetry && action.controls.canRetry && (
				<Button
					size="sm"
					variant="ghost"
					disabled={controlsBusy}
					aria-busy={controlsBusy}
					onClick={onRetry}
				>
					Retry
				</Button>
			)}
			{controlError && <span>{controlError}</span>}
		</Element>
	);
}
