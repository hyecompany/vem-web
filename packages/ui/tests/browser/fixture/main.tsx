// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	Button,
	Card,
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	createToastManager,
	Input,
	InputGroup,
	InputGroupInput,
	Sidebar,
	SidebarContent,
	SidebarHeader,
	SidebarInset,
	SidebarNavigation,
	SidebarProvider,
	SidebarTrigger,
	Switch,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	Toaster,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@hyecompany/vem-ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@hyecompany/vem-ui/styles.css";

const manager = createToastManager();
let mounts = 0;
function Demand() {
	useEffect(() => {
		document.documentElement.dataset.mounts = String(++mounts);
		document.documentElement.dataset.activeDemand = "true";
		return () => {
			document.documentElement.dataset.activeDemand = "false";
		};
	}, []);
	return null;
}
function App() {
	const [choice, setChoice] = useState("Forest");
	const [tags, setTags] = useState(["Picnic"]);
	const [changes, setChanges] = useState(0);
	const [portal, setPortal] = useState<HTMLDivElement | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const sidebar = useRef<HTMLDivElement>(null);
	const notice = useRef<string | null>(null);
	return (
		<TooltipProvider>
			<Toaster toastManager={manager} timeout={0} container={portal}>
				<SidebarProvider defaultOpen style={{ minHeight: "100vh" }}>
					<Sidebar
						ref={sidebar}
						title="Application navigation"
						className="custom-sidebar"
						data-custom="kept"
						style={{ letterSpacing: "0.25px" }}
						collapsible="icon"
						variant="inset"
					>
						<SidebarHeader>
							<header>Example</header>
							<SidebarTrigger aria-label="Close navigation" />
						</SidebarHeader>
						<SidebarContent>
							<SidebarNavigation
								aria-label="Primary"
								items={[
									{
										key: "tasks",
										label: "Tasks",
										render: <a href="#tasks">Tasks</a>,
										isActive: true,
									},
									{
										key: "storage",
										label: "Storage",
										render: <a href="#storage">Storage</a>,
										children: [
											{
												key: "volumes",
												label: "Volumes",
												render: <a href="#volumes">Volumes</a>,
											},
										],
									},
								]}
							/>
						</SidebarContent>
					</Sidebar>
					<SidebarInset>
						<div className="examples">
							<h1>Controls</h1>
							<Combobox multiple value={tags} onValueChange={setTags}>
								<ComboboxChips>
									{tags.map((tag) => (
										<ComboboxChip key={tag}>{tag}</ComboboxChip>
									))}
									<ComboboxChipsInput aria-label="Labels" />
								</ComboboxChips>
							</Combobox>
							<Button hidden data-testid="hidden-button">
								Hidden button
							</Button>
							<Card hidden data-testid="hidden-card">
								Hidden card
							</Card>
							<Textarea
								hidden
								data-testid="hidden-textarea"
								aria-label="Hidden notes"
							/>
							<InputGroup id="tall-group" style={{ height: 48 }}>
								<InputGroupInput aria-label="Tall field" />
							</InputGroup>
							<div className="hidden" data-testid="host-hidden">
								Host hidden content
							</div>
							<SidebarTrigger aria-label="Toggle navigation" />
							<Button
								onClick={() => {
									document.documentElement.dataset.sidebarRef =
										sidebar.current?.getAttribute("data-custom") ?? "missing";
								}}
							>
								Read sidebar ref
							</Button>
							<Button
								render={<a href="#tasks">Open tasks</a>}
								nativeButton={false}
								variant="outline"
							>
								Open tasks
							</Button>
							<Button disabled>Unavailable</Button>
							<form onSubmit={(event) => event.preventDefault()}>
								<label htmlFor="email">Email</label>
								<Input
									ref={input}
									id="email"
									name="email"
									type="email"
									defaultValue="hello@example.com"
								/>
								<Button onClick={() => input.current?.focus()}>
									Focus email
								</Button>
								<label htmlFor="notes">Notes</label>
								<Textarea
									id="notes"
									name="notes"
									defaultValue="Original notes"
								/>
								<label htmlFor="enabled">
									<Switch id="enabled" name="enabled" defaultChecked /> Enabled
								</label>
								<Button type="reset" variant="outline">
									Reset form
								</Button>
							</form>
							<div ref={setPortal} id="portal-scope" className="brand-a">
								<Combobox
									items={["Forest", "Café", "Weekend walk"]}
									value={choice}
									onValueChange={(value) => {
										setChoice(value ?? "");
										setChanges((count) => count + 1);
									}}
									name="project"
								>
									<ComboboxInput aria-label="Project" showClear />
									<ComboboxContent container={portal}>
										<Demand />
										<ComboboxEmpty>No projects found.</ComboboxEmpty>
										<ComboboxList>
											{(item: string) => (
												<ComboboxItem key={item} value={item}>
													{item}
												</ComboboxItem>
											)}
										</ComboboxList>
									</ComboboxContent>
								</Combobox>
								<output aria-label="Selection">{choice}</output>
								<output aria-label="Changes">{changes}</output>
								<Button id="branded-button">Branded button</Button>
								<Tooltip>
									<TooltipTrigger render={<Button variant="outline" />}>
										Help
									</TooltipTrigger>
									<TooltipContent container={portal}>
										Useful guidance
									</TooltipContent>
								</Tooltip>
							</div>
							<div className="bg-primary" id="unscoped">
								Ordinary host element
							</div>
							<Tabs defaultValue="overview" orientation="vertical">
								<TabsList aria-label="Views" activateOnFocus>
									<TabsTrigger value="overview">Overview</TabsTrigger>
									<TabsTrigger value="details">Details</TabsTrigger>
								</TabsList>
								<TabsContent value="overview">Overview content</TabsContent>
								<TabsContent value="details">Details content</TabsContent>
							</Tabs>
							<Button
								onClick={() => {
									notice.current = manager.add({
										title: "Working",
										type: "loading",
										timeout: 0,
										actionProps: { children: "Undo", onClick: () => {} },
									});
								}}
							>
								Add notification
							</Button>
							<Button
								onClick={() => {
									if (notice.current)
										manager.update(notice.current, {
											title: "Finished",
											type: "success",
										});
								}}
							>
								Update notification
							</Button>
							<Button
								onClick={() => {
									if (notice.current) manager.close(notice.current);
								}}
							>
								Close notification
							</Button>
							<div id="tasks">Task destination</div>
						</div>
					</SidebarInset>
				</SidebarProvider>
			</Toaster>
		</TooltipProvider>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
