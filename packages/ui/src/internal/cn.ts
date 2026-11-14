// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { utilityClasses } from "./utility-classes.js";

const prefix = "vem-u-";
const marker = /^(group|peer)(\/|$)/;
const tokens = (value: ClassValue) => clsx(value).split(/\s+/).filter(Boolean);
const original = (name: string) =>
	name.startsWith(prefix) && utilityClasses.has(name.slice(prefix.length))
		? name.slice(prefix.length)
		: name;

/** Merge component defaults with caller classes while namespacing only library-owned utilities. */
export function cn(defaults: ClassValue, className?: ClassValue) {
	const overrides = tokens(className);
	const callerClasses = new Set(
		overrides.filter((name) => !name.startsWith(prefix)),
	);
	const merged = twMerge(
		[...tokens(defaults), ...overrides].map(original).join(" "),
	);
	return [...new Set(merged.split(/\s+/))]
		.map((name) => {
			if (!utilityClasses.has(name)) return name;
			if (marker.test(name)) return `${name} ${prefix}${name}`;
			return callerClasses.has(name) ? name : `${prefix}${name}`;
		})
		.join(" ");
}
