// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useQuery } from "@hyecompany/vem-data/react";
import {
	Check,
	Database,
	Fingerprint,
	Radio,
	RefreshCw,
	Thermometer,
	TriangleAlert,
	Wifi,
	WifiOff,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Session } from "../lesson/Session";
import { TaskApp } from "../lesson/TaskApp";
import { Teaching } from "../lesson/Teaching";
import { createLiveness, liveTask } from "./sources/liveness";

const labels = { id: "Task ID", title: "Title", temperature: "Temperature" };
function Board({ session }: { session: ReturnType<typeof createLiveness> }) {
	const state = useSyncExternalStore(
		session.subscribe,
		session.snapshot,
		session.snapshot,
	);
	const result = useQuery(
		liveTask.get("walk", { select: ["id", "title", "temperature"] }),
	);
	const row = result.rows[0] ?? result.unresolved[0];
	const connected =
		state.phase === "connected" || state.phase === "reconnected";
	const explanation = {
		connected:
			"The title follows task events. The ID cannot change; the temperature is a sample from one read. Go offline to see the difference.",
		offline:
			"The title may have missed changes and needs another read. The ID is still immutable; the temperature remains an ordinary snapshot.",
		changed:
			"The service changed while disconnected. Vem has no event for the new title, and it never promised to keep the temperature current.",
		reconnected: result.revalidating
			? "The old title stays visible while Vem checks it. Let the service reply, or make this check fail."
			: result.stale
				? result.issues.some((issue) => issue.kind === "read")
					? "The check failed. The last-known title stays visible, without claiming that a check is still running."
					: "The title is last known; it still needs to be checked."
				: "Only the title needed another read. Its event coverage is live again. The temperature is still the earlier sample.",
	}[state.phase];
	return (
		<>
			<Teaching
				learned={state.phase !== "connected"}
				metric={`${state.reads.length} service reads`}
			>
				{explanation}
			</Teaching>
			<div className="planning-layout">
				<TaskApp
					label="Field currency task board"
					toolbar={
						<Badge variant={connected ? "success" : "warning"}>
							{connected ? (
								<Wifi aria-hidden="true" />
							) : (
								<WifiOff aria-hidden="true" />
							)}
							{connected ? "Events connected" : "Offline"}
						</Badge>
					}
				>
					<dl className="currency-fields">
						{(["id", "title", "temperature"] as const).map((field) => {
							const status = row?.fields[field],
								Icon = {
									id: Fingerprint,
									title: Radio,
									temperature: Thermometer,
								}[field];
							const value = row?.data[field];
							return (
								<div key={field} data-currency-field={field}>
									<dt>
										<Icon aria-hidden="true" />
										{labels[field]}
									</dt>
									<dd>
										<strong>
											{value === undefined
												? "Reading…"
												: field === "temperature"
													? `${value}°C`
													: value}
										</strong>
										{status && (
											<Badge
												variant={
													status.stale
														? "warning"
														: status.liveness === "live"
															? "success"
															: "secondary"
												}
											>
												{status.stale
													? result.revalidating
														? "Checking…"
														: "Last known"
													: status.liveness === "live"
														? "Live"
														: status.liveness === "immutable"
															? "Immutable"
															: "Snapshot"}
											</Badge>
										)}
									</dd>
								</div>
							);
						})}
					</dl>
					<div className="planning-board-footer">
						{state.phase === "reconnected" && result.revalidating && (
							<>
								<Button size="sm" onClick={() => session.reply()}>
									Let the service reply
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => session.reply(true)}
								>
									Return an error
								</Button>
							</>
						)}
						{state.phase === "reconnected" &&
							result.stale &&
							!result.fetching && (
								<Button size="sm" onClick={() => void result.retry()}>
									Try again
								</Button>
							)}
						{state.phase !== "reconnected" && (
							<Button size="sm" disabled={!row} onClick={() => session.next()}>
								{state.phase === "connected"
									? "Go offline"
									: state.phase === "offline"
										? "Change the service"
										: "Reconnect"}
							</Button>
						)}
					</div>
				</TaskApp>
				<Card
					className="planning-receipt"
					role="region"
					aria-label="Field read history"
				>
					<header>
						<Database aria-hidden="true" />
						<strong>What was read</strong>
						<Badge variant="secondary">{state.reads.length}</Badge>
					</header>
					<ol>
						{state.reads.map((read) => (
							<li key={read.id} data-state={read.state}>
								<span className="planning-read-icon">
									{read.state === "failed" ? (
										<TriangleAlert aria-label="Failed" />
									) : read.state === "reading" ? (
										<RefreshCw aria-label="Checking" />
									) : (
										<Check aria-label="Finished" />
									)}
								</span>
								<div>
									<strong>
										{read.fields
											.map((field) => labels[field as keyof typeof labels])
											.join(", ")}
									</strong>
									<p>
										{read.state === "failed"
											? "Service unavailable; known values remain."
											: read.state === "reading"
												? "Waiting for the service; known values remain."
												: "Returned the requested fields."}
									</p>
								</div>
							</li>
						))}
					</ol>
					{(state.phase === "changed" || state.phase === "reconnected") && (
						<div className="currency-service">
							<span>On the service now</span>
							<strong>{state.service.title}</strong>
							<p>{state.service.temperature}°C</p>
						</div>
					)}
				</Card>
			</div>
			<p className="currency-footnote">
				This temperature is a single sample. Repeated measurements require an
				explicit sampling query; ordinary snapshots do not poll.
			</p>
		</>
	);
}
export function Liveness() {
	return (
		<Session create={createLiveness}>
			{(session) => <Board session={session} />}
		</Session>
	);
}
