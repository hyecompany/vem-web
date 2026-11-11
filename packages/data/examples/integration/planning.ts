// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region sources
import type {
	AcquisitionSource,
	ObservationBatch,
	ResourceContext,
} from "@hyecompany/vem-data/runtime";

interface TaskReads {
	all(context: ResourceContext): Promise<ObservationBatch>;
	one(id: string, context: ResourceContext): Promise<ObservationBatch>;
}
export function taskSources(api: TaskReads): readonly AcquisitionSource[] {
	return [
		{
			key: "all-tasks",
			mode: "list",
			fields: ["title", "status", "notes"],
			membership: true,
			cost: 3,
			run: (_request, context) => api.all(context),
		},
		{
			key: "one-task",
			mode: "one",
			fields: ["title", "status", "notes"],
			cost: 1,
			run: (request, context) =>
				api.one((request.identity as { id: string }).id, context),
		},
	];
}
// #endregion sources

// #region paged-source
interface TaskPage {
	tasks: Array<{ id: string; title: string; status: string }>;
	next?: string;
	complete: boolean;
}
export function pagedTasks(
	load: (url: URL, signal: AbortSignal) => Promise<TaskPage>,
): AcquisitionSource {
	return {
		key: "task-pages",
		mode: "list",
		fields: ["title", "status"],
		membership: true,
		filters: ["status"],
		pagination: { pageSize: 50, maxPages: 20 },
		async run(request, context) {
			const url = new URL("/api/tasks", "https://tasks.example");
			if (request.where?.status)
				url.searchParams.set("status", String(request.where.status));
			url.searchParams.set("limit", String(request.page?.limit));
			if (request.page?.cursor)
				url.searchParams.set("cursor", String(request.page.cursor));
			const page = await load(url, context.signal);
			return {
				batch: {
					facts: page.tasks.map(({ id, ...values }) => ({
						resource: "tasks",
						identity: { id },
						values,
						presence: "present",
						basis: ["public"],
					})),
					memberships: [
						{
							resource: "tasks",
							where: request.where,
							identities: page.tasks.map(({ id }) => ({ id })),
							complete: page.complete,
							basis: ["public"],
						},
					],
				},
				next: page.next,
			};
		},
	};
}

// #endregion paged-source

// #region read-prerequisites
import type { ResourceDefinition } from "@hyecompany/vem-data/runtime";

export const taskReadPrerequisites: ResourceDefinition["readPrerequisites"] =
	() => [
		{
			kind: "query",
			resource: "service",
			mode: "one",
			identity: "current",
			select: ["features"],
		},
	];
// #endregion read-prerequisites

// #region url-source
export function taskUrlSource(
	load: (signal: AbortSignal) => Promise<readonly string[]>,
): AcquisitionSource {
	return {
		key: "task-links",
		mode: "list",
		fields: [],
		membership: true,
		async run(_request, context) {
			const identities = (await load(context.signal)).map((href) => {
				const path = new URL(href, "https://tasks.example").pathname;
				const match = /^\/api\/tasks\/([^/]+)$/.exec(path);
				if (!match?.[1]) throw new Error("Unexpected task URL");
				return { id: decodeURIComponent(match[1]) };
			});
			return {
				facts: identities.map((identity) => ({
					resource: "tasks",
					identity,
					presence: "present",
					basis: ["public"],
				})),
				memberships: [
					{
						resource: "tasks",
						identities,
						complete: true,
						basis: ["public"],
					},
				],
			};
		},
	};
}
// #endregion url-source
