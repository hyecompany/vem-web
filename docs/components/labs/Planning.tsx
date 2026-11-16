// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import {
	Badge,
	Button,
	Card,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@hyecompany/vem-ui";
import { Check, Database, LoaderCircle, TriangleAlert } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Session } from "../lesson/Session";
import { Teaching } from "../lesson/Teaching";
import { PagedPlanningBoard, PlanningBoard } from "./PlanningViews";
import {
	createPlanning,
	type PlanningLesson,
	type PlanningSession,
} from "./sources/planning";

const lessons = [
	["choices", "Choose together"],
	["sharing", "Share a reply"],
	["pages", "Filter and pages"],
] as const;
function explanation(lesson: PlanningLesson, session: PlanningSession) {
	const reads = session.snapshot(),
		latest = reads.at(-1);
	if (reads.some((read) => read.state === "failed"))
		return "That read failed. Vem tried another source for the missing information; the task views did not choose the fallback.";
	if (lesson === "sharing")
		return latest?.source === "all"
			? latest.state === "reading"
				? "The task notes are waiting for one reply. Open the notes overview before letting the service finish."
				: "The same reply filled the task cards and the overview. The extra view needed no extra read."
			: "Open all notes. We will pause the reply so you can add another view while it is in progress.";
	if (lesson === "pages")
		return latest?.source === "all"
			? "The full board needed the tasks outside the earlier filter. Vem chose one complete collection read. Switching back to To do reuses it."
			: latest?.state === "reading"
				? "Only unfinished tasks were requested. One is visible already; Vem has asked for the next page automatically."
				: "The final page establishes the full To do list. Try All tasks to change what the board needs.";
	return latest?.source === "all"
		? "All three note views needed the same three tasks. One collection reply supplied them together."
		: latest?.source === "one"
			? "One note view only needed one task. Reopen its notes and the known information is reused."
			: "Open all notes to see Vem combine three views. Start over and open a single task to compare.";
}
function Receipt({
	lesson,
	session,
}: {
	lesson: PlanningLesson;
	session: PlanningSession;
}) {
	const reads = useSyncExternalStore(
		session.subscribe,
		session.snapshot,
		session.snapshot,
	);
	const pending = reads.some((read) => read.state === "reading");
	return (
		<Card className="planning-receipt" role="region" aria-label="Service reads">
			<header>
				<Database aria-hidden="true" />
				<strong>Service reads</strong>
				<Badge variant="secondary">{reads.length}</Badge>
			</header>
			<ol>
				{reads.map((read) => (
					<li key={read.id} data-source={read.source} data-state={read.state}>
						<span className="planning-read-icon">
							{read.state === "failed" ? (
								<TriangleAlert aria-label="Failed" />
							) : read.state === "finished" ? (
								<Check aria-label="Finished" />
							) : (
								<LoaderCircle
									className="motion-safe:animate-spin"
									aria-label="In progress"
								/>
							)}
						</span>
						<div>
							<strong>
								{read.label}
								{read.state === "failed" && " · failed"}
							</strong>
							<p>{read.fields}</p>
						</div>
					</li>
				))}
			</ol>
			{pending && (
				<div className="planning-reply-controls">
					<Button size="sm" onClick={() => session.finish()}>
						Let the service reply
					</Button>
					<Button size="sm" variant="ghost" onClick={() => session.fail()}>
						Return an error
					</Button>
				</div>
			)}
			<details>
				<summary>Why these choices?</summary>
				<p>
					{lesson === "pages"
						? "This simulated service charges one unit per returned task. The filtered pages return two tasks; the full board returns three."
						: "The task list establishes three identities. One open note needs one task; all three open notes can share one collection reply."}
				</p>
				<dl>
					<div>
						<dt>One task with notes</dt>
						<dd>1 task</dd>
					</div>
					<div>
						<dt>Complete collection</dt>
						<dd>All 3 tasks</dd>
					</div>
					{lesson === "pages" ? (
						<div>
							<dt>Filtered pages</dt>
							<dd>1 matching task per page</dd>
						</div>
					) : (
						<div>
							<dt>Task list</dt>
							<dd>Titles and status; no notes</dd>
						</div>
					)}
				</dl>
				<p>
					{lesson === "pages"
						? "The fixture knows its exact records and declares those charges. This is an explicit service model, not an estimate Vem invents."
						: "These sources use Vem's default policy with no assigned costs. The receipt lists actual calls to the simulated service."}
				</p>
			</details>
		</Card>
	);
}
function Lesson({
	lesson,
	session,
}: {
	lesson: PlanningLesson;
	session: PlanningSession;
}) {
	const reads = useSyncExternalStore(
		session.subscribe,
		session.snapshot,
		session.snapshot,
	);
	return (
		<>
			<Teaching
				learned={reads.some((read) => read.source !== "summaries")}
				metric={`${reads.length} service ${reads.length === 1 ? "read" : "reads"}`}
			>
				{explanation(lesson, session)}
			</Teaching>
			<div className="planning-layout">
				{lesson === "pages" ? (
					<PagedPlanningBoard />
				) : (
					<PlanningBoard sharing={lesson === "sharing"} />
				)}
				<Receipt lesson={lesson} session={session} />
			</div>
		</>
	);
}
function PlanningLessonView({ lesson }: { lesson: PlanningLesson }) {
	const create = useCallback(() => createPlanning(lesson), [lesson]);
	return (
		<Session create={create}>
			{(session) => <Lesson lesson={lesson} session={session} />}
		</Session>
	);
}
export function Planning() {
	const [lesson, setLesson] = useState<PlanningLesson>("choices");
	return (
		<Tabs
			value={lesson}
			onValueChange={(value) => setLesson(value as PlanningLesson)}
		>
			<TabsList activateOnFocus aria-label="Automatic planning lessons">
				{lessons.map(([name, title]) => (
					<TabsTrigger key={name} value={name}>
						{title}
					</TabsTrigger>
				))}
			</TabsList>
			{lessons.map(([name]) => (
				<TabsContent key={name} value={name}>
					<PlanningLessonView lesson={name} />
				</TabsContent>
			))}
		</Tabs>
	);
}
