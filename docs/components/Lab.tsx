// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import dynamic from "next/dynamic";
import { LabFrame } from "./lesson/LabFrame";

const components = {
	knowledge: dynamic(() =>
		import("./labs/Knowledge").then((module) => module.Knowledge),
	),
	liveness: dynamic(() =>
		import("./labs/Liveness").then((module) => module.Liveness),
	),
	planning: dynamic(() =>
		import("./labs/Planning").then((module) => module.Planning),
	),
	results: dynamic(() =>
		import("./labs/Results").then((module) => module.Results),
	),
	actions: dynamic(() =>
		import("./labs/Actions").then((module) => module.Actions),
	),
	editor: dynamic(() =>
		import("./labs/Editor").then((module) => module.Editor),
	),
	access: dynamic(() =>
		import("./labs/Access").then((module) => module.Access),
	),
	recovery: dynamic(() =>
		import("./labs/Recovery").then((module) => module.Recovery),
	),
};
export function Lab({ name }: { name: keyof typeof components }) {
	const Experiment = components[name];
	return (
		<LabFrame name={name}>
			<Experiment />
		</LabFrame>
	);
}
