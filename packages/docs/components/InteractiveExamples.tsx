// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

// The shared MDX map must not pull experiment code into prose pages.
const DynamicLab = dynamic(() => import("./Lab").then((module) => module.Lab));
const DynamicTaskBoard = dynamic(() =>
	import("./TaskBoardDemo").then((module) => module.TaskBoardDemo),
);

export function Lab(props: ComponentProps<typeof DynamicLab>) {
	return <DynamicLab {...props} />;
}
export function TaskBoardDemo() {
	return <DynamicTaskBoard />;
}
