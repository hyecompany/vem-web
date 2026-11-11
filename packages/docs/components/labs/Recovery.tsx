// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { DataProvider, useQuery } from "@hyecompany/vem-data/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Session } from "../lesson/Session";
import { TaskApp, TaskList } from "../lesson/TaskApp";
import { Teaching } from "../lesson/Teaching";
import { tasks } from "./model";
import { createRecovery } from "./sources/recovery";

function Content({
	onComplete,
	disabled,
}: {
	onComplete(): void;
	disabled: boolean;
}) {
	const result = useQuery(tasks.list({ select: ["title", "status"] }));
	return (
		<TaskApp>
			<TaskList result={result} onComplete={onComplete} busy={disabled} />
		</TaskApp>
	);
}
function Board({ session }: { session: ReturnType<typeof createRecovery> }) {
	const [client, setClient] = useState(session.client);
	const [stage, setStage] = useState<
		"ready" | "sending" | "sent" | "opening" | "restored"
	>("ready");
	const [error, setError] = useState("");
	async function submit() {
		setStage("sending");
		try {
			await session.submit();
			setStage("sent");
		} catch (error) {
			setError(String(error));
		}
	}
	useEffect(() => {
		if (stage !== "opening") return;
		let attached = true;
		void session
			.reopen()
			.then((next) => {
				if (attached && next) {
					setClient(next);
					setStage("restored");
				}
			})
			.catch((error) => {
				if (attached) setError(String(error));
			});
		return () => {
			attached = false;
		};
	}, [stage, session]);
	const counts = session.counts();
	return (
		<>
			<Teaching learned={stage !== "ready"}>
				{stage === "restored"
					? "The app checked what happened instead of sending the command again. With no reply, the result stays unconfirmed."
					: stage === "sent"
						? "The command was sent, but no reply arrived. Close and reopen the app below."
						: "Complete the walk. This time, imagine closing the app before its reply arrives."}
			</Teaching>
			{stage === "opening" ? (
				<p className="app-message">Reopening the task board…</p>
			) : (
				<DataProvider client={client}>
					<Content
						onComplete={() => void submit()}
						disabled={stage !== "ready"}
					/>
				</DataProvider>
			)}
			{stage === "sent" && (
				<div className="service-reply">
					<span>The reply hasn’t arrived.</span>
					<Button size="sm" onClick={() => setStage("opening")}>
						Close and reopen app
					</Button>
				</div>
			)}
			{stage === "restored" && (
				<p className="action-feedback">
					Sent {counts.submissions} time · checked {counts.checks} time · still
					unconfirmed
				</p>
			)}
			{error && <p role="alert">{error}</p>}
		</>
	);
}
export function Recovery() {
	return (
		<Session create={createRecovery}>
			{(session) => <Board session={session} />}
		</Session>
	);
}
