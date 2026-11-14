// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Button } from "@hyecompany/vem-ui";
import dynamic from "next/dynamic";
import { useState } from "react";
import catalog from "@/content/ui-components.json";

const examples = {
	appearance: dynamic(() =>
		import("../../../ui/examples/appearance").then((m) => m.AppearanceExample),
	),
	button: dynamic(() =>
		import("../../../ui/examples/button").then((m) => m.ButtonExample),
	),
	input: dynamic(() =>
		import("../../../ui/examples/input").then((m) => m.InputExample),
	),
	textarea: dynamic(() =>
		import("../../../ui/examples/textarea").then((m) => m.TextareaExample),
	),
	switch: dynamic(() =>
		import("../../../ui/examples/switch").then((m) => m.SwitchExample),
	),
	tabs: dynamic(() =>
		import("../../../ui/examples/tabs").then((m) => m.TabsExample),
	),
	badge: dynamic(() =>
		import("../../../ui/examples/badge").then((m) => m.BadgeExample),
	),
	card: dynamic(() =>
		import("../../../ui/examples/card").then((m) => m.CardExample),
	),
	separator: dynamic(() =>
		import("../../../ui/examples/separator").then((m) => m.SeparatorExample),
	),
	tooltip: dynamic(() =>
		import("../../../ui/examples/tooltip").then((m) => m.TooltipExample),
	),
	combobox: dynamic(() =>
		import("../../../ui/examples/combobox").then((m) => m.ComboboxExample),
	),
	"virtual-list": dynamic(() =>
		import("../../../ui/examples/virtual-list").then(
			(m) => m.VirtualListExample,
		),
	),
	sidebar: dynamic(() =>
		import("../../../ui/examples/sidebar").then((m) => m.SidebarExample),
	),
	breadcrumb: dynamic(() =>
		import("../../../ui/examples/breadcrumb").then((m) => m.BreadcrumbExample),
	),
	toast: dynamic(() =>
		import("../../../ui/examples/toast").then((m) => m.ToastExample),
	),
	"input-group": dynamic(() =>
		import("../../../ui/examples/input-group").then((m) => m.InputGroupExample),
	),
	sheet: dynamic(() =>
		import("../../../ui/examples/sheet").then((m) => m.SheetExample),
	),
	skeleton: dynamic(() =>
		import("../../../ui/examples/skeleton").then((m) => m.SkeletonExample),
	),
	"command-button": dynamic(() =>
		import("./DataPreviews").then((m) => m.ActionPreview),
	),
	"activity-feedback": dynamic(() =>
		import("./DataPreviews").then((m) => m.ActionPreview),
	),
	"activity-toasts": dynamic(() =>
		import("./DataPreviews").then((m) => m.FeedbackPreview),
	),
	"query-status": dynamic(() =>
		import("./DataPreviews").then((m) => m.QueryPreview),
	),
	"data-bindings": dynamic(() =>
		import("./DataPreviews").then((m) => m.EditPreview),
	),
};

export function ComponentPreview({ name }: { name: keyof typeof examples }) {
	const [revision, setRevision] = useState(0);
	const component =
		name === "appearance"
			? {
					title: "Appearance",
					description: "Brand a button through ordinary CSS.",
				}
			: catalog.find((item) => item.name === name);
	const Example = examples[name];
	return (
		<figure
			className="component-preview not-prose"
			aria-label={`${component?.title} example`}
		>
			<div className="component-preview-toolbar">
				<span>Example</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setRevision((value) => value + 1)}
				>
					Reset
				</Button>
			</div>
			<div className="component-preview-body" key={revision}>
				<Example />
			</div>
			<figcaption>{component?.description}</figcaption>
		</figure>
	);
}
