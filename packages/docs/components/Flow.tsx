// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	Blocks,
	Check,
	Database,
	FileText,
	Layers,
	LayoutPanelTop,
	ListFilter,
	Network,
	Pencil,
	Radio,
	Search,
	Send,
	ShieldCheck,
} from "lucide-react";
import diagrams from "@/content/diagrams.json";

const icons = {
	blocks: Blocks,
	check: Check,
	database: Database,
	file: FileText,
	layers: Layers,
	layout: LayoutPanelTop,
	list: ListFilter,
	network: Network,
	pencil: Pencil,
	radio: Radio,
	search: Search,
	send: Send,
	shield: ShieldCheck,
};
export function Flow({ name }: { name: keyof typeof diagrams }) {
	const diagram = diagrams[name];
	return (
		<figure
			className="learning-flow not-prose"
			data-flow={name}
			aria-label={diagram.title}
		>
			<figcaption>{diagram.title}</figcaption>
			<ol className="flow-track">
				{diagram.nodes.map((node, index) => {
					const Icon = icons[node.icon as keyof typeof icons];
					return (
						<li key={node.title} data-tone={node.tone}>
							<div className="flow-node-title">
								<span className="flow-icon">
									<Icon aria-hidden="true" />
								</span>
								<strong>
									{name !== "ownership" && (
										<span className="flow-number">{index + 1}. </span>
									)}
									{node.title}
								</strong>
							</div>
							<p>{node.summary}</p>
						</li>
					);
				})}
			</ol>
			<p className="flow-explanation">{diagram.explanation}</p>
		</figure>
	);
}
