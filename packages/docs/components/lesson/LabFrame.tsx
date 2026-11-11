// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import { RotateCcw } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import experiments from "@/content/experiments.json";

export function LabFrame({
	name,
	children,
}: {
	name: keyof typeof experiments;
	children: ReactNode;
}) {
	const [revision, setRevision] = useState(0);
	const content = experiments[name];
	return (
		<section className="lesson not-prose" aria-label={content.title}>
			<div className="lesson-heading">
				<h3>{content.title}</h3>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => setRevision((value) => value + 1)}
				>
					<RotateCcw aria-hidden="true" />
					Start over
				</Button>
			</div>
			<Fragment key={revision}>{children}</Fragment>
			<details className="lesson-about">
				<summary>About this example</summary>
				<p>{content.explanation}</p>
				<p>
					{name === "recovery"
						? "The runtime and its recovery journal run in this page using memory storage. Reopening is simulated; this does not test a browser crash or IndexedDB."
						: "This example uses the real Vem runtime and an in-memory task service. Source reads are simulated calls, not HTTP requests. Views share this page, not a SharedWorker."}
				</p>
			</details>
		</section>
	);
}
