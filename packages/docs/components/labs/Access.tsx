// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useQuery } from "@hyecompany/vem-data/react";
import { Button, Switch } from "@hyecompany/vem-ui";
import { useId, useState } from "react";
import { Session } from "../lesson/Session";
import { PrivateNote, TaskApp, TaskList } from "../lesson/TaskApp";
import { Situation, Teaching } from "../lesson/Teaching";
import { tasks } from "./model";
import { createAccess } from "./sources/access";

function Board({ session }: { session: ReturnType<typeof createAccess> }) {
	const [team, setTeam] = useState(true);
	const [owner, setOwner] = useState(true);
	const [held, setHeld] = useState<"none" | "waiting" | "held" | "delivered">(
		"none",
	);
	const result = useQuery(tasks.list({ select: ["title", "status", "notes"] }));
	const id = useId();
	const note = result.rows[0]?.data.notes;
	function access(scope: string, allowed: boolean) {
		if (allowed)
			session.client.setAccess({ decisions: [{ scope, state: "allowed" }] });
		else session.client.revoke(scope);
	}
	return (
		<>
			<Teaching learned={!team || !owner || held === "delivered"}>
				{!note
					? team || owner
						? "Read access is back. A new authorized reply can supply the notes."
						: "The notes lost their last permission. They disappeared, while the public task title stayed."
					: !team || !owner
						? "One permission is enough. The notes stay readable through the other one."
						: "Turn off Team access. You also have a direct invitation—will the notes stay?"}
			</Teaching>
			<TaskApp>
				<TaskList result={result} />
				<PrivateNote
					value={note}
					missing={team || owner ? "Waiting for updated notes." : undefined}
				/>
			</TaskApp>
			<div className="access-settings">
				<span>Access to private notes</span>
				<label htmlFor={`${id}-team`}>
					Team access
					<Switch
						id={`${id}-team`}
						checked={team}
						onCheckedChange={(value) => {
							access("team", value);
							setTeam(value);
						}}
					/>
				</label>
				<label htmlFor={`${id}-owner`}>
					Direct invitation
					<Switch
						id={`${id}-owner`}
						checked={owner}
						onCheckedChange={(value) => {
							access("owner", value);
							setOwner(value);
						}}
					/>
				</label>
			</div>
			<Situation label="What if an old reply arrives later?">
				<p>
					Hold a reply, turn off both permissions, then turn one back on before
					delivering it.
				</p>
				<div className="scenario-buttons">
					<Button
						size="sm"
						variant="outline"
						disabled={held !== "none"}
						onClick={() => {
							setHeld("waiting");
							session.holdReply();
							void session.started.then(() => setHeld("held"));
						}}
					>
						Hold a reply
					</Button>
					{held !== "none" && (
						<Button
							size="sm"
							variant="outline"
							disabled={held !== "held"}
							onClick={() => {
								session.response.resolve();
								setHeld("delivered");
							}}
						>
							Deliver held reply
						</Button>
					)}
					{held === "delivered" && (team || owner) && (
						<Button size="sm" onClick={() => session.sendUpdate()}>
							Send a new update
						</Button>
					)}
				</div>
				{held === "held" && <p>Reply held. Change the permissions above.</p>}
				{held === "delivered" && (
					<p>
						The old reply cannot restore notes after their permission was
						withdrawn. A new update can.
					</p>
				)}
			</Situation>
		</>
	);
}
export function Access() {
	return (
		<Session create={createAccess}>
			{(session) => <Board session={session} />}
		</Session>
	);
}
