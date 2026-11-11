// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { commandKey, stableKey } from "../descriptors.js";
import { createRuntime } from "../runtime.js";
import type {
	AccessState,
	AcquisitionSource,
	ActionOutcome,
	CommandDefinition,
	CommandDescriptor,
	EditDefinition,
	EditDescriptor,
	ResourceDefinition,
	Values,
} from "../types.js";
import { equal } from "../values.js";
import {
	commandDefinition,
	editDefinitions,
	editName,
	editScope,
	editWriteScope,
	queryScope,
} from "./definitions.js";
import { deferred } from "./memory.js";
import { fixtureRows, reconcileQueryFixtures } from "./query-fixtures.js";
import type {
	CommandFixture,
	EditFixture,
	EditFixtureInput,
	QueryFixtureInput,
	TestClient,
	TestClientOptions,
} from "./types.js";

export function createTestClient(options: TestClientOptions = {}): TestClient {
	const queries = new Map<string, QueryFixtureInput>();
	const candidates = new Map<string, ReturnType<typeof fixtureRows>>();
	const commands = new Map<string, CommandFixture>();
	const edits = new Map<string, EditFixtureInput>();
	const pending = new Map<string, ReturnType<typeof deferred<void>>>();
	const calls: CommandDescriptor[] = [];
	const saves: TestClient["saves"][number][] = [];
	const names = new Set([
		...(options.resources ?? []),
		...(options.queries ?? []).map((fixture) => fixture.query.resource),
		...(options.commands ?? []).map((fixture) => fixture.command.resource),
		...(options.edits ?? []).map((fixture) => fixture.edit.resource),
	]);
	const observation = (fixture: QueryFixtureInput) => ({
		facts: [...(fixture.rows ?? []), ...(fixture.unresolved ?? [])].map(
			(row) => ({
				resource: fixture.query.resource,
				identity: row.identity,
				values: row.data as Values,
				replace: fixture.replace,
				presence: "present" as const,
				basis: [queryScope(fixture.query)],
			}),
		),
		memberships:
			fixture.query.mode === "list" &&
			(fixture.status !== "loading" || (fixture.rows?.length ?? 0) > 0)
				? [
						{
							resource: fixture.query.resource,
							scope: fixture.query.scope,
							where: fixture.query.where,
							identities: (fixture.rows ?? []).map((row) => row.identity),
							complete:
								fixture.status && fixture.status !== "ready"
									? false
									: (fixture.complete ?? true),
							basis: [queryScope(fixture.query)],
						},
					]
				: [],
	});
	const definitions = new Map(
		[...names].map((name) => {
			const definition: ResourceDefinition & {
				sources: AcquisitionSource[];
				commands: Record<string, CommandDefinition>;
				edits: Record<string, EditDefinition>;
			} = {
				name,
				inScope: options.scopes?.[name],
				access: (descriptor) => queryScope(descriptor),
				sources: [],
				commands: {},
				edits: {},
			};
			return [name, definition] as const;
		}),
	);
	const runtime = createRuntime({ resources: [...definitions.values()] });
	const definition = (resource: string) => {
		const result = definitions.get(resource);
		if (!result)
			throw new Error(
				`Declare resource ${resource} in the test client catalog`,
			);
		return result;
	};

	const addQuerySource = (fixture: QueryFixtureInput) => {
		const descriptor = fixture.query;
		const source: AcquisitionSource = {
			key: stableKey(descriptor),
			mode: descriptor.mode,
			fields: [
				...new Set([
					...descriptor.select,
					...Object.keys(descriptor.where ?? {}),
					...(fixture.rows ?? []).flatMap((row) => Object.keys(row.data)),
					...(fixture.unresolved ?? []).flatMap((row) => Object.keys(row.data)),
				]),
			],
			membership: descriptor.mode === "list",
			filters: Object.keys(descriptor.where ?? {}),
			available: (request) =>
				equal(request.scope, descriptor.scope) &&
				(request.mode !== "one" ||
					equal(request.identity, descriptor.identity)) &&
				equal(request.where ?? {}, descriptor.where ?? {}),
			run: async (_request, context) => {
				const key = stableKey(descriptor);
				let fixture = queries.get(key);
				if (!fixture)
					throw new Error(`No query fixture for ${descriptor.resource}`);
				while (fixture.status === "loading") {
					if (context.signal.aborted) return;
					const wait = pending.get(key) ?? deferred<void>();
					pending.set(key, wait);
					const canceled = deferred<void>();
					const abort = () => canceled.resolve();
					context.signal.addEventListener("abort", abort, { once: true });
					try {
						await Promise.race([wait.promise, canceled.promise]);
					} finally {
						context.signal.removeEventListener("abort", abort);
					}
					if (context.signal.aborted) return;
					fixture = queries.get(key) ?? fixture;
				}
				if (fixture.status === "failed")
					throw new Error(fixture.error ?? "The fixture read failed");
				if (fixture.status === "denied") return;
				context.observe(observation(fixture));
			},
		};
		definition(descriptor.resource).sources.push(source);
	};
	const setQuery = (fixture: QueryFixtureInput) => {
		definition(fixture.query.resource);
		const key = stableKey(fixture.query);
		const replacing = queries.has(key);
		const previous = queries.get(key);
		const affected = reconcileQueryFixtures(
			queries,
			candidates,
			fixture,
			options.scopes?.[fixture.query.resource],
		);
		queries.set(key, fixture);
		candidates.set(key, fixtureRows(fixture));
		if (!replacing) addQuerySource(fixture);
		runtime.setAccess({
			decisions: [
				{
					scope: queryScope(fixture.query),
					state: fixture.status === "denied" ? "denied" : "allowed",
				},
			],
		});
		runtime.observe({
			...observation(fixture),
			invalidateMemberships: affected
				.filter((query) => query.mode === "list")
				.map((query) => ({
					resource: query.resource,
					scope: query.scope,
					where: query.where,
				})),
		});
		if (fixture.query.mode === "one" && fixture.exists === false)
			runtime.observe({
				facts: [
					{
						resource: fixture.query.resource,
						identity: fixture.query.identity,
						presence: "absent",
						basis: [queryScope(fixture.query)],
					},
				],
			});
		pending.get(key)?.resolve();
		pending.delete(key);
		if (replacing)
			runtime.observe({
				invalidate: [
					...new Map(
						[...fixtureRows(previous), ...fixtureRows(fixture)].map((row) => [
							stableKey(row.identity),
							row.identity,
						]),
					).values(),
				].flatMap((identity) =>
					fixture.query.select.map((field) => ({
						resource: fixture.query.resource,
						identity,
						field,
					})),
				),
				invalidateMemberships:
					fixture.query.mode === "list"
						? [
								{
									resource: fixture.query.resource,
									scope: fixture.query.scope,
									where: fixture.query.where,
								},
							]
						: [],
			});
	};
	const setOutcome: TestClient["setOutcome"] = (fixture) => {
		commands.set(commandKey(fixture.command), fixture);
		definition(fixture.command.resource).commands[fixture.command.name] =
			commandDefinition(commands, calls);
		runtime.setAccess({ decisions: [] });
	};
	const applyEditAccess = (fixture: EditFixtureInput) =>
		runtime.setAccess({
			decisions: [
				...Object.keys(fixture.values).map((field) => ({
					scope: editScope(fixture.edit, field),
					state: fixture.fields?.[field] ?? ("allowed" as AccessState),
				})),
				{
					scope: editWriteScope(fixture.edit),
					state: fixture.write ?? "allowed",
				},
			],
		});
	const setEdit = (fixture: EditFixtureInput) => {
		const resource = definition(fixture.edit.resource);
		const representation = editDefinitions(fixture.edit.resource, edits, saves);
		resource.edits[fixture.edit.name] = representation.edit;
		resource.commands[editName(fixture.edit.name)] = representation.save;
		edits.set(stableKey(fixture.edit), fixture);
		applyEditAccess(fixture);
	};
	const setEditAccess: TestClient["setEditAccess"] = (descriptor, access) => {
		const key = stableKey(descriptor);
		const current = edits.get(key);
		if (!current) throw new Error("No edit fixture for this descriptor");
		const next = {
			...current,
			write: access.write ?? current.write,
			fields: { ...current.fields, ...access.fields },
		};
		edits.set(key, next);
		applyEditAccess(next);
	};
	for (const fixture of options.queries ?? []) setQuery(fixture);
	for (const fixture of options.commands ?? []) setOutcome(fixture);
	for (const fixture of options.edits ?? []) setEdit(fixture);
	return {
		client: runtime,
		calls,
		saves,
		setQuery,
		setOutcome,
		setEdit,
		getEdit: <T extends object, O extends ActionOutcome = ActionOutcome>(
			descriptor: EditDescriptor<T, unknown, O>,
		) => {
			const fixture = edits.get(stableKey(descriptor));
			return fixture
				? ({
						...fixture,
						values: structuredClone(fixture.values),
					} as EditFixture<T, O>)
				: undefined;
		},
		setEditAccess,
		close: () => {
			runtime.close();
			for (const wait of pending.values()) wait.resolve();
			pending.clear();
		},
	};
}
