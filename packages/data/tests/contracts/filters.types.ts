// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import {
	defineResource,
	type FilterExpression,
	type ResourceFilter,
	type Where,
} from "@hyecompany/vem-data";
import type { AcquisitionSource } from "@hyecompany/vem-data/runtime";

interface Project {
	name: string;
	description?: string;
	priority: number;
	status: "open" | "closed";
	config: { environment: string };
	tags: readonly string[];
}
const projects = defineResource<Project, string>()({
	name: "projects",
	fields: ["name", "description", "priority", "status", "config", "tags"],
	defaultSelect: ["name"],
});
const condition: ResourceFilter<typeof projects> = {
	$or: [
		{ name: { contains: "dev", case: "insensitive" } },
		{ description: { contains: "dev" } },
	],
};
projects.list({ where: condition });
projects.list({
	where: { $and: [condition, { status: "open" }], priority: { eq: 2 } },
});
projects.list({ where: { description: { eq: undefined } } });
projects.list({ where: { config: { eq: { environment: "production" } } } });
projects.list({ where: { tags: { eq: ["one", "two"] } } });
const reusable: Where<Project> = { priority: 2 };
projects.list({ select: ["name"], where: reusable });
// @ts-expect-error Text conditions require a string field.
projects.list({ where: { priority: { contains: "2" } } });
// @ts-expect-error Fields must belong to the resource.
projects.list({ where: { secret: { contains: "dev" } } });
// @ts-expect-error Nested conditions retain field constraints.
projects.list({ where: { $or: [condition, { secret: "dev" }] } });
// @ts-expect-error Equality retains the field's type.
projects.list({ where: { priority: { eq: "2" } } });
// @ts-expect-error Equality retains literal unions.
projects.list({ where: { status: "invalid" } });
// @ts-expect-error Equality and substring conditions cannot be combined in one field operator.
projects.list({ where: { name: { eq: "dev", contains: "dev" } } });
// @ts-expect-error Unsupported comparison modes cannot be described.
projects.list({ where: { name: { contains: "dev", case: "folded" } } });
// @ts-expect-error Object equality must be explicit.
projects.list({ where: { config: { environment: "production" } } });
// @ts-expect-error Arrays are equality operands, not implicit conditions.
projects.list({ where: { tags: ["one"] } });
// @ts-expect-error A required string field cannot be explicitly equal to undefined.
projects.list({ where: { name: { eq: undefined } } });
// @ts-expect-error Group operators require arrays.
projects.list({ where: { $or: { name: "dev" } } });

const source: AcquisitionSource = {
	key: "search",
	mode: "list",
	fields: ["name"],
	filters: {
		fields: ["name", "description"],
		operators: ["contains"],
		combinations: ["any"],
		text: [{ case: "insensitive", accents: "sensitive" }],
		supports(expression: FilterExpression) {
			return expression.$filter === "any";
		},
	},
	run: async () => undefined,
};
void source;
