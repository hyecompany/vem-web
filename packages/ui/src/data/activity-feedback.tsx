// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ActionSnapshot, QueryDescriptor } from "@hyecompany/vem-data";
import {
	useActivities,
	useInlineFeedback,
	useQuery,
} from "@hyecompany/vem-data/react";
import type { ReactNode } from "react";
import { ActivityPresentation } from "./activity-presentation.js";
import { ManagedActivity } from "./managed-activity.js";

export type ActivityFeedbackProps<
	T extends object = Record<string, unknown>,
	I = unknown,
> = {
	label?: ReactNode;
	className?: string;
	/** Hidden regions release their claim and query demand. */
	active?: boolean;
	/** Override the native cancellation request, for example to ask for confirmation. */
	onCancel?(action: ActionSnapshot): void | Promise<void>;
	/** Override explicit retry handling; uncertainty never enables retry automatically. */
	onRetry?(action: ActionSnapshot): void | Promise<void>;
} & (
	| { query: QueryDescriptor<T, I>; actionIds?: never; action?: never }
	| { actionIds: readonly string[]; query?: never; action?: never }
	| { action: ActionSnapshot; query?: never; actionIds?: never }
);
type FeedbackPresentation = Pick<
	ActivityFeedbackProps,
	"label" | "className" | "active" | "onCancel" | "onRetry"
>;
/** Own inline feedback for a query or explicit action IDs. Snapshot mode is presentation-only for diagnostics. */
export function ActivityFeedback<T extends object, I>(
	props: ActivityFeedbackProps<T, I>,
) {
	if (props.active === false) return null;
	if (props.query) return <QueryFeedback {...props} query={props.query} />;
	if (props.actionIds)
		return <IdentifiedFeedback {...props} actionIds={props.actionIds} />;
	return (
		<FeedbackList
			{...props}
			managed={false}
			actions={props.action ? [props.action] : []}
		/>
	);
}
function QueryFeedback<T extends object, I>({
	query,
	...props
}: FeedbackPresentation & { query: QueryDescriptor<T, I> }) {
	const result = useQuery(query);
	useInlineFeedback(query);
	return <FeedbackList {...props} actions={result.activities} />;
}
function IdentifiedFeedback({
	actionIds,
	...props
}: FeedbackPresentation & { actionIds: readonly string[] }) {
	const actions = useActivities();
	useInlineFeedback(actionIds);
	return (
		<FeedbackList
			{...props}
			actions={actions.filter((action) => actionIds.includes(action.id))}
		/>
	);
}
function FeedbackList({
	actions,
	label,
	className,
	onCancel,
	onRetry,
	managed = true,
}: FeedbackPresentation & {
	actions: readonly ActionSnapshot[];
	managed?: boolean;
}) {
	const Presentation = managed ? ManagedActivity : ActivityPresentation;
	return (
		<>
			{actions.map((action) => (
				<Presentation
					key={action.id}
					action={action}
					label={label}
					className={className}
					onCancel={onCancel ? () => onCancel(action) : undefined}
					onRetry={onRetry ? () => onRetry(action) : undefined}
				/>
			))}
		</>
	);
}
