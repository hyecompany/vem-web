// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionSnapshot } from "@hyecompany/vem-data";
import type { ScenarioClient } from "@hyecompany/vem-data/devtools";
import { Button } from "../button.js";
import { ActivityFeedback } from "../data/activity-feedback.js";
import { InspectorCard } from "./controls.js";
import { outcomeKinds, scenarioOutcome } from "./outcomes.js";

export function ActivitiesPanel({
	actions,
	scenarios,
}: {
	actions: readonly ActionSnapshot[];
	scenarios?: ScenarioClient;
}) {
	return (
		<div className="vem-inspector-stack">
			{actions.length ? (
				actions.map((action) => (
					<InspectorCard key={action.id}>
						<h3 className="vem-inspector-heading">
							{action.resource} · {action.name}
						</h3>
						<ActivityFeedback action={action} />
						{scenarios?.canAdvance(action.id) && (
							<div className="vem-inspector-actions">
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										scenarios?.progress(action.id, {
											completed: 50,
											total: 100,
											message: "Simulated progress: 50%",
										})
									}
								>
									Progress to 50%
								</Button>
								{outcomeKinds.map((kind) => (
									<Button
										key={kind}
										size="sm"
										variant="outline"
										onClick={() =>
											scenarios?.settle(action.id, scenarioOutcome(kind))
										}
									>
										Finish: {kind}
									</Button>
								))}
							</div>
						)}
					</InspectorCard>
				))
			) : (
				<p>
					Run an action from the screen to inspect its progress and outcome.
				</p>
			)}
		</div>
	);
}
