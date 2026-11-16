// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { command, edit, freezeValue, query } from "./descriptors.js";
import { filterFields } from "./filters.js";
import type {
	ActionOutcome,
	CommandDescriptor,
	CommandResult,
	EditDescriptor,
	QueryDescriptor,
} from "./types.js";
import type { Where } from "./where.js";

export interface CommandContract<
	Input = unknown,
	Outcome extends ActionOutcome = ActionOutcome,
	Target = never,
> {
	readonly __input?: Input;
	readonly __outcome?: Outcome;
	readonly __target?: Target;
}

export interface EditContract<
	T extends object = object,
	Outcome extends ActionOutcome = ActionOutcome,
	Target = never,
> {
	readonly __values?: T;
	readonly __outcome?: Outcome;
	readonly __target?: Target;
}

/** Declare a command input, supported outcome, and optional target type; this creates no execution. */
export function defineCommand<
	Input = void,
	Outcome extends ActionOutcome = ActionOutcome,
	Target = never,
>(): CommandContract<Input, Outcome, Target> {
	return Object.freeze({});
}

/** Declare writable values, supported save outcomes, and optional target type; this prepares no baseline. */
export function defineEdit<
	T extends object,
	Outcome extends ActionOutcome = ActionOutcome,
	Target = never,
>(): EditContract<T, Outcome, Target> {
	return Object.freeze({});
}

/** @inline */
type Field<T> = keyof T & string;
/** @inline */
type Commands = Readonly<
	Record<string, CommandContract<unknown, ActionOutcome, unknown>>
>;
/** @inline */
type Editors = Readonly<
	Record<string, EditContract<object, ActionOutcome, unknown>>
>;
type Target<T, I> = [T] extends [never] ? I : T;
type InputArguments<T> = undefined extends T ? [input?: T] : [input: T];
/** @inline */
type BoundCommands<C extends Commands, I> = {
	readonly [K in keyof C]: C[K] extends CommandContract<
		infer Input,
		infer Outcome,
		infer CommandTarget
	>
		? (
				target: Target<CommandTarget, I>,
				...args: InputArguments<Input>
			) => CommandDescriptor<Input, CommandResult<Outcome>>
		: never;
};
/** @inline */
type BoundEditors<E extends Editors, I> = {
	readonly [K in keyof E]: E[K] extends EditContract<
		infer T,
		infer Outcome,
		infer EditTarget
	>
		? (
				target: Target<EditTarget, I>,
			) => EditDescriptor<T, Target<EditTarget, I>, CommandResult<Outcome>>
		: never;
};

export interface QueryOptions<
	T extends object,
	S,
	K extends readonly Field<T>[],
> {
	select?: K;
	scope?: S;
	where?: Where<T>;
	orderBy?: readonly { field: Field<T>; direction?: "asc" | "desc" }[];
	sample?: { fields: readonly K[number][]; intervalMs: number };
}
/** @inline */
type ScopeArgument<S, D> = [D] extends [undefined]
	? undefined extends S
		? { scope?: S }
		: { scope: S }
	: { scope?: S };
export type ListArguments<
	T extends object,
	S,
	K extends readonly Field<T>[],
	D,
> = [D] extends [undefined]
	? undefined extends S
		? [options?: QueryOptions<T, S, K>]
		: [options: QueryOptions<T, S, K> & ScopeArgument<S, D>]
	: [options?: QueryOptions<T, S, K>];

export interface ResourceContract<
	T extends object,
	I,
	S,
	D extends readonly Field<T>[],
	C extends Commands,
	E extends Editors,
	DefaultScope = undefined,
> {
	readonly name: string;
	readonly fields: readonly Field<T>[];
	readonly defaultSelect: D;
	readonly commands: BoundCommands<C, I>;
	readonly edits: BoundEditors<E, I>;
	readonly __types?: { values: T; identity: I; scope: S; filter: Where<T> };
	list<const K extends readonly Field<T>[] = D>(
		...args: ListArguments<T, S, K, DefaultScope>
	): QueryDescriptor<Pick<T, K[number]>, I>;
	get<const K extends readonly Field<T>[] = D>(
		identity: I,
		options?: QueryOptions<T, S, K>,
	): QueryDescriptor<Pick<T, K[number]>, I>;
}

/** @inline */
type ContractTypes<R> = R extends { readonly __types?: infer T }
	? NonNullable<T>
	: never;
export type ResourceValues<R> =
	ContractTypes<R> extends { values: infer T } ? T : never;
export type ResourceIdentity<R> =
	ContractTypes<R> extends { identity: infer I } ? I : never;
export type ResourceScope<R> =
	ContractTypes<R> extends { scope: infer S } ? S : never;
export type ResourceFilter<R> =
	ContractTypes<R> extends { filter: infer W } ? W : never;

/** Define named, typed, side-effect-free queries, commands, and editors for one resource. Selected fields determine the query result type. */
export function defineResource<T extends object, I, S = undefined>() {
	return <
		const F extends readonly Field<T>[],
		const D extends readonly Field<T>[] = F,
		C extends Commands = Record<never, never>,
		E extends Editors = Record<never, never>,
		DefaultScope extends S | undefined = undefined,
	>(definition: {
		name: string;
		fields: F;
		defaultSelect?: D;
		defaultScope?: DefaultScope;
		scopeOf?(identity: I): S;
		commands?: C;
		edits?: E;
	}): ResourceContract<T, I, S, D, C, E, DefaultScope> => {
		const { name, scopeOf } = definition;
		const fields = Object.freeze([...new Set(definition.fields)]);
		const defaultSelect = Object.freeze([
			...(definition.defaultSelect ?? fields),
		]) as unknown as D;
		const defaultScope =
			definition.defaultScope === undefined
				? undefined
				: freezeValue(structuredClone(definition.defaultScope));
		const validate = (selected: readonly string[]) => {
			for (const field of selected)
				if (!fields.includes(field as Field<T>))
					throw new TypeError(`Unknown ${name} field: ${field}`);
		};
		validate(defaultSelect);
		const describe = <K extends readonly Field<T>[]>(
			mode: "one" | "list",
			identity: I | undefined,
			options: QueryOptions<T, S, K> = {},
		): QueryDescriptor<Pick<T, K[number]>, I> => {
			const select = options.select ?? defaultSelect;
			validate(select);
			const scope =
				mode === "one" && scopeOf ? scopeOf(identity as I) : defaultScope;
			const descriptor = query({
				resource: name,
				mode,
				...(mode === "one" ? { identity } : {}),
				...(scope === undefined ? {} : { scope }),
				...options,
				select,
			}) as QueryDescriptor<Pick<T, K[number]>, I>;
			validate(filterFields(descriptor.where));
			return descriptor;
		};
		const commands = Object.fromEntries(
			Object.keys(definition.commands ?? {}).map((commandName) => [
				commandName,
				(target: unknown, input: unknown) =>
					command({ resource: name, name: commandName, target, input }),
			]),
		) as BoundCommands<C, I>;
		const edits = Object.fromEntries(
			Object.keys(definition.edits ?? {}).map((editName) => [
				editName,
				(target: unknown) => edit({ resource: name, name: editName, target }),
			]),
		) as BoundEditors<E, I>;
		return Object.freeze({
			name,
			fields,
			defaultSelect,
			commands: Object.freeze(commands),
			edits: Object.freeze(edits),
			list: (
				...[options]: ListArguments<T, S, readonly Field<T>[], DefaultScope>
			) => describe("list", undefined, options),
			get: <const K extends readonly Field<T>[] = D>(
				identity: I,
				options?: QueryOptions<T, S, K>,
			) => describe("one", identity, options),
		}) as ResourceContract<T, I, S, D, C, E, DefaultScope>;
	};
}
