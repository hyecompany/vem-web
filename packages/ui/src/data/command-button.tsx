// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type {
	ActionHandle,
	ActionOutcome,
	CommandDescriptor,
	CommandResult,
} from "@hyecompany/vem-data";
import { useCommand } from "@hyecompany/vem-data/react";
import {
	type ComponentProps,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "../button.js";
import { Spinner } from "../spinner.js";

export interface CommandButtonProps<
	I = unknown,
	O extends ActionOutcome = ActionOutcome,
> extends Omit<ComponentProps<typeof Button>, "onClick"> {
	command: CommandDescriptor<I, O>;
	/** Receive the immediate shared handle, without creating an operation registry. */
	onAction?(action: ActionHandle<CommandResult<O>>): void;
}
/** Run a command and observe this button's last action. Repeated activation is blocked until that action settles. */
export function CommandButton<I, O extends ActionOutcome>({
	command: descriptor,
	onAction,
	disabled,
	children,
	...props
}: CommandButtonProps<I, O>) {
	const command = useCommand(descriptor);

	const [attempt, setAttempt] = useState<{
		run: typeof command.run;
		action?: ActionHandle<CommandResult<O>>;
		failed?: boolean;
	}>();
	const running = useRef<
		| { run: typeof command.run; action: ActionHandle<CommandResult<O>> }
		| undefined
	>(undefined);
	const current = attempt?.run === command.run ? attempt : undefined;
	const action = current?.action;
	const id = useId();
	const binding = useMemo(
		() => ({
			subscribe: (listener: () => void) =>
				action?.subscribe(listener) ?? (() => undefined),
			snapshot: () => action?.getSnapshot(),
		}),
		[action],
	);
	const snapshot = useSyncExternalStore(
		binding.subscribe,
		binding.snapshot,
		binding.snapshot,
	);
	const busy = snapshot !== undefined && snapshot.phase !== "settled";
	const reason =
		command.availability.reason ??
		(current?.failed
			? "The command could not be started. Check its current availability before trying again."
			: undefined);
	return (
		<span className="vem-command-button">
			<Button
				{...props}
				disabled={disabled || !command.canRun || busy}
				aria-busy={busy}
				aria-describedby={
					[props["aria-describedby"], reason ? id : undefined]
						.filter(Boolean)
						.join(" ") || undefined
				}
				onClick={() => {
					if (
						disabled ||
						!command.canRun ||
						(running.current?.run === command.run &&
							running.current.action.getSnapshot().phase !== "settled")
					)
						return;
					let next: ActionHandle<CommandResult<O>>;
					try {
						next = command.run();
						running.current = { run: command.run, action: next };
						setAttempt({ run: command.run, action: next });
					} catch {
						setAttempt({ run: command.run, failed: true });
						return;
					}
					onAction?.(next);
				}}
			>
				{busy && <Spinner size="sm" aria-hidden="true" />}
				{children}
			</Button>
			{reason && (
				<span id={id} className="vem-command-reason">
					{reason}
				</span>
			)}
		</span>
	);
}
