// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { FeedbackClient } from "../feedback-types.js";

import type {
	AccessState,
	ActionContext,
	ActionOutcome,
	ActionProjection,
	Availability,
	CommandDescriptor,
	CommandResult,
	DataClient,
	EditDescriptor,
	QueryDescriptor,
	Values,
} from "../types.js";

export interface QueryFixture<T extends object = Values, I = unknown> {
	query: QueryDescriptor<T, I>;
	rows?: readonly { identity: I; data: Partial<T> }[];
	unresolved?: readonly { identity: I; data: Partial<T> }[];
	complete?: boolean;
	exists?: boolean;
	status?: "ready" | "loading" | "denied" | "failed";
	error?: string;
	// Replace these fields when switching scenarios so omitted values do not survive an earlier fixture.
	replace?: readonly (keyof T & string)[];
}
export interface CommandFixture<O extends ActionOutcome = ActionOutcome> {
	command: CommandDescriptor<unknown, O>;
	outcome: O | ((context: ActionContext) => O | Promise<O>);
	availability?: Availability;
	proposals?: readonly ActionProjection[];
}
export interface EditAccess<T extends object> {
	fields?: Partial<Record<keyof T & string, AccessState>>;
	write?: AccessState;
}
export interface EditFixture<
	T extends object = Values,
	O extends ActionOutcome = ActionOutcome,
> extends EditAccess<T> {
	edit: EditDescriptor<T, unknown, O>;
	values: T;
	etag?: string | null;
	outcome?:
		| CommandResult<O>
		| (() => CommandResult<O> | Promise<CommandResult<O>>);
}
/** @inline */
export interface QueryFixtureInput
	extends Omit<QueryFixture, "query" | "rows" | "unresolved"> {
	query: Omit<QueryDescriptor, "__values">;
	rows?: readonly { identity: unknown; data: object }[];
	unresolved?: readonly { identity: unknown; data: object }[];
}
/** @inline */
export interface EditFixtureInput extends EditAccess<Values> {
	edit: Omit<EditDescriptor, "__values">;
	values: object;
	etag?: string | null;
	outcome?: ActionOutcome | (() => ActionOutcome | Promise<ActionOutcome>);
}
export interface TestClientOptions {
	resources?: readonly string[];
	scopes?: Readonly<
		Record<
			string,
			(
				identity: unknown,
				scope: unknown,
				values: Readonly<Values>,
			) => boolean | "unknown"
		>
	>;
	queries?: readonly QueryFixtureInput[];
	commands?: readonly CommandFixture[];
	edits?: readonly EditFixtureInput[];
}
export interface TestClient {
	client: DataClient & FeedbackClient;
	readonly feedback: FeedbackClient;
	readonly calls: readonly CommandDescriptor[];
	readonly saves: readonly {
		edit: Omit<EditDescriptor, "__values">;
		values: Readonly<Values>;
		etag: string | null;
	}[];
	setQuery<T extends object, I>(fixture: QueryFixture<T, I>): void;
	setOutcome<O extends ActionOutcome>(fixture: CommandFixture<O>): void;
	setEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		fixture: EditFixture<T, O>,
	): void;
	getEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		descriptor: EditDescriptor<T, unknown, O>,
	): EditFixture<T, O> | undefined;
	setEditAccess<T extends object>(
		descriptor: EditDescriptor<T>,
		access: EditAccess<T>,
	): void;
	close(): void;
}
