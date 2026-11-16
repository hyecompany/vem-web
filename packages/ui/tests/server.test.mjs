// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	OverflowText,
	Sidebar,
	SidebarContent,
	SidebarInset,
	SidebarMenuSkeleton,
	SidebarProvider,
	Spinner,
} from "@hyecompany/vem-ui";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

test("complete labels and accessible activity indicators render without browser globals", () => {
	const text = "A very long résumé 👩🏽‍🚀 with its original ending";
	const html = render(
		h("button", { type: "button" }, h(OverflowText, { text })),
	);
	assert.ok(html.includes(text));
	assert.ok(html.includes('class="vem-sr-only"'));
	assert.ok(!html.includes('data-vem-overflow="true"'));
	assert.match(render(h(Spinner)), /aria-label="Loading"/);
	assert.match(
		render(h(Spinner, { "aria-label": "Saving" })),
		/aria-label="Saving"/,
	);
	assert.doesNotMatch(
		render(h(Spinner, { "aria-hidden": true })),
		/aria-label=/,
	);
	assert.doesNotMatch(
		render(h(Spinner, { "aria-labelledby": "save-status" })),
		/aria-label=/,
	);
});

test("composable controls render on the server with native semantics and stable skeletons", () => {
	const html = render(
		h(
			SidebarProvider,
			{ defaultOpen: true },
			h(Sidebar, null, h(SidebarContent, null, "Navigation")),
			h(
				SidebarInset,
				null,
				h(
					Button,
					{
						nativeButton: false,
						render: h("a", { href: "/tasks" }),
						variant: "outline",
					},
					"Tasks",
				),
				h(
					Combobox,
					{ items: ["One"] },
					h(ComboboxInput, { "aria-label": "Choose" }),
					h(ComboboxContent, null, "Closed content"),
				),
			),
		),
	);
	assert.match(html, /<a[^>]*href="\/tasks"/);
	assert.match(html, /data-vem-ui=""/);
	assert.match(html, /<main/);
	assert.doesNotMatch(html, /Closed content/);
	assert.equal(render(h(SidebarMenuSkeleton)), render(h(SidebarMenuSkeleton)));
});

test("entry points preserve client boundaries without importing Data or injecting styles", async () => {
	const source = await readFile(
		new URL("../dist/index.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/@hyecompany\/vem-data|\.\/data\/|styles\.css|"use client"/,
	);
	for (const name of [
		"overflow-text",
		"combobox",
		"sidebar",
		"badge",
		"breadcrumb",
		"sheet",
	]) {
		assert.match(
			await readFile(new URL(`../dist/${name}.js`, import.meta.url), "utf8"),
			/"use client";/,
			name,
		);
	}
});
