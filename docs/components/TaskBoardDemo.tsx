// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import {
	Button,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@hyecompany/vem-ui";
import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { Actions } from "./labs/Actions";
import { Editor } from "./labs/Editor";
import { Knowledge } from "./labs/Knowledge";
import { LabFrame } from "./lesson/LabFrame";

// Keep all three steps available offline once this walkthrough has loaded.
const components = { knowledge: Knowledge, actions: Actions, editor: Editor };

const lessons = [
	["knowledge", "Find a task"],
	["actions", "Finish a task"],
	["editor", "Edit a task"],
] as const;
export function TaskBoardDemo() {
	const container = useRef<HTMLDivElement>(null);
	const [lesson, setLesson] = useState("knowledge");
	const index = lessons.findIndex(([name]) => name === lesson);
	return (
		<div className="lesson-tour not-prose" ref={container}>
			<Tabs value={lesson} onValueChange={setLesson}>
				<TabsList activateOnFocus aria-label="Task board walkthrough">
					{lessons.map(([name, title], i) => (
						<TabsTrigger value={name} key={name}>
							<span>{i + 1}</span>
							{title}
						</TabsTrigger>
					))}
				</TabsList>
				{lessons.map(([name]) => {
					const Experiment = components[name];
					return (
						<TabsContent value={name} key={name}>
							<LabFrame name={name}>
								<Experiment />
							</LabFrame>
						</TabsContent>
					);
				})}
			</Tabs>
			{index < lessons.length - 1 && (
				<div className="lesson-next">
					<Button
						variant="ghost"
						onClick={() => {
							setLesson(lessons[index + 1][0]);
							requestAnimationFrame(() => {
								container.current
									?.querySelector<HTMLElement>(
										'[role="tab"][aria-selected="true"]',
									)
									?.focus({ preventScroll: true });
								container.current?.scrollIntoView({
									block: "start",
									behavior: "instant",
								});
							});
						}}
					>
						Next: {lessons[index + 1][1].toLowerCase()}
						<ArrowRight aria-hidden="true" />
					</Button>
				</div>
			)}
		</div>
	);
}
