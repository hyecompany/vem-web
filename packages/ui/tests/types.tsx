// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxVirtualList,
	OverflowText,
	type OverflowTextProps,
	Sidebar,
	SidebarMenuButton,
	Spinner,
	type SpinnerProps,
	Switch,
	Tabs,
	TabsList,
	Textarea,
	TooltipContent,
	VirtualList,
	type VirtualListHandle,
} from "@hyecompany/vem-ui";
import { createRef } from "react";

const label: OverflowTextProps = {
	text: "A complete label",
	style: { maxWidth: 180 },
	dir: "rtl",
};
const status: SpinnerProps = { size: "sm", "aria-label": "Saving" };
<OverflowText {...label} />;
<Spinner {...status} />;
// @ts-expect-error Text is required; children do not replace the complete label.
<OverflowText>Missing text</OverflowText>;
// @ts-expect-error Supported size names are explicit.
<Spinner size="huge" />;
// @ts-expect-error Activity indicators do not accept children.
<Spinner>Saving</Spinner>;

<Button
	variant="outline"
	size="icon-sm"
	aria-label="Save"
	ref={createRef<HTMLButtonElement>()}
/>;
<Button nativeButton={false} render={<a href="/tasks">Tasks</a>}>
	Tasks
</Button>;
// @ts-expect-error Invalid variants should fail at the caller.
<Button variant="invalid">Invalid</Button>;
<Textarea aria-label="Notes" rows={4} ref={createRef<HTMLTextAreaElement>()} />;
<Switch
	checked
	onCheckedChange={(checked, details) => {
		const value: boolean = checked;
		void value;
		void details.reason;
	}}
/>;
const tasks = [{ id: 1, label: "Pack a picnic" }];
<Combobox<(typeof tasks)[number]>
	items={tasks}
	itemToStringLabel={(item) => item.label}
	itemToStringValue={(item) => String(item.id)}
	onValueChange={(value) => {
		const item: { id: number; label: string } | null = value;
		void item;
	}}
>
	<ComboboxInput aria-label="Task" />
	<ComboboxContent container={createRef<HTMLDivElement>()}>
		<ComboboxList>
			{(item: (typeof tasks)[number]) => (
				<ComboboxItem key={item.id} value={item}>
					{item.label}
				</ComboboxItem>
			)}
		</ComboboxList>
	</ComboboxContent>
</Combobox>;
<Sidebar
	ref={createRef<HTMLDivElement>()}
	title="Navigation"
	container={createRef<HTMLDivElement>()}
/>;
<SidebarMenuButton render={<a href="/tasks">Tasks</a>} isActive tooltip="Tasks">
	Tasks
</SidebarMenuButton>;
<Tabs orientation="vertical">
	<TabsList activateOnFocus />
</Tabs>;
<TooltipContent container={createRef<HTMLDivElement>()}>Help</TooltipContent>;

// @ts-expect-error Styled wrappers merge class strings; state callbacks are not part of this prop.
<Button className={() => "invalid-callback"}>Save</Button>;
// @ts-expect-error The switch wrapper also takes a class string, not a primitive state callback.
<Switch className={() => "invalid-callback"} />;
<Button style={(state) => ({ opacity: state.disabled ? 0.5 : 1 })}>
	Save
</Button>;

<VirtualList
	items={tasks}
	getItemKey={(task) => task.id}
	actionsRef={createRef<VirtualListHandle>()}
>
	{(task, state) => {
		const visible: boolean = state.visible;
		return visible ? task.label : null;
	}}
</VirtualList>;
<ComboboxVirtualList<(typeof tasks)[number]> getItemKey={(task) => task.id}>
	{(task) => <ComboboxItem value={task}>{task.label}</ComboboxItem>}
</ComboboxVirtualList>;
// @ts-expect-error Stable row identities are strings or numbers, not objects.
<VirtualList items={tasks} getItemKey={(task) => task}>
	{(task) => task.label}
</VirtualList>;
