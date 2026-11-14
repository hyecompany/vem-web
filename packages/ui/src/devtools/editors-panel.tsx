// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	EditInspection,
	ScenarioClient,
} from "@hyecompany/vem-data/devtools";
import { useState } from "react";
import { Button } from "../button.js";
import { InspectorCard, ScenarioSelect } from "./controls.js";

function EditorCard({
	edit,
	scenarios,
}: {
	edit: EditInspection;
	scenarios?: ScenarioClient;
}) {
	const [field, setField] = useState(edit.fields[0] ?? "");
	const selectedField = field || edit.fields[0] || "";
	return (
		<InspectorCard data-edit-name={edit.descriptor.name}>
			<h3 className="vem-inspector-heading">
				{edit.descriptor.resource} · {edit.descriptor.name}
			</h3>
			<p className="vem-inspector-identity">
				{JSON.stringify(edit.descriptor.target)}
			</p>
			<p>
				Last preparation: {edit.status}
				{edit.message ? `: ${edit.message}` : ""}
			</p>
			<p className="vem-inspector-small">
				Baseline fields: {edit.fields.join(", ") || "Not established"}
			</p>
			{scenarios && (
				<div className="vem-inspector-controls">
					<div className="vem-inspector-actions">
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								scenarios?.setEdit(edit.id, { externalChange: true })
							}
						>
							Change server baseline
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => scenarios?.setEdit(edit.id, { write: "denied" })}
						>
							Deny saving
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								scenarios?.setEdit(edit.id, {
									write: "allowed",
									fields: Object.fromEntries(
										edit.fields.map((name) => [name, "allowed"]),
									),
								})
							}
						>
							Restore permissions
						</Button>
					</div>
					<ScenarioSelect
						label="Protected field"
						value={selectedField}
						choices={edit.fields}
						onValueChange={setField}
					/>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedField}
						onClick={() =>
							scenarios?.setEdit(edit.id, {
								fields: { [selectedField]: "denied" },
							})
						}
					>
						Revoke field access
					</Button>
					<p className="vem-inspector-hint">
						Dirty input must survive an external baseline change. Save to
						exercise conditional-write conflict. Read revocation must remove the
						protected value; restoring permission requires preparing a new
						baseline.
					</p>
				</div>
			)}
		</InspectorCard>
	);
}

export function EditorsPanel({
	edits,
	scenarios,
}: {
	edits: readonly EditInspection[];
	scenarios?: ScenarioClient;
}) {
	return (
		<div className="vem-inspector-stack">
			<p className="vem-inspector-hint">
				Editors observed in this tab. Draft values and current form state stay
				inside their managed sessions.
			</p>
			{edits.length ? (
				edits.map((edit) => (
					<EditorCard key={edit.id} edit={edit} scenarios={scenarios} />
				))
			) : (
				<p>Open an editor to discover its managed session.</p>
			)}
		</div>
	);
}
