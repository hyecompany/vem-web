// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryResult } from "@hyecompany/vem-data";
import { ArrowRight, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";
export function Teaching({
	children,
	learned = false,
	metric,
}: {
	children: ReactNode;
	learned?: boolean;
	metric?: ReactNode;
}) {
	return (
		<div className="teaching-note" data-learned={learned}>
			{learned ? (
				<Lightbulb aria-hidden="true" />
			) : (
				<ArrowRight aria-hidden="true" />
			)}
			<p aria-live="polite" aria-atomic="true">
				{children}
			</p>
			{metric && <span className="teaching-metric">{metric}</span>}
		</div>
	);
}
export function Situation({
	children,
	label = "Try a different situation",
}: {
	children: ReactNode;
	label?: string;
}) {
	return (
		<details className="lesson-situation">
			<summary>{label}</summary>
			<div className="situation-body">{children}</div>
		</details>
	);
}
export function QueryEvidence<T extends object, I>({
	result,
}: {
	result: QueryResult<T, I>;
}) {
	return (
		<details className="lesson-evidence">
			<summary>How Vem sees this</summary>
			<dl>
				<div>
					<dt>Matching rows</dt>
					<dd>{result.rows.length}</dd>
				</div>
				<div>
					<dt>Unresolved candidates</dt>
					<dd>{result.unresolved.length}</dd>
				</div>
				<div>
					<dt>Confirmed matches</dt>
					<dd>
						{result.confirmed.knownCount}
						{result.confirmed.complete ? " · complete" : " · more may exist"}
					</dd>
				</div>
			</dl>
			<p>
				{result.empty
					? "Complete membership proves this result is empty."
					: "A row can remain visible even when some of its fields are missing."}
			</p>
		</details>
	);
}
