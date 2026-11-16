// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { FeedbackClient, FeedbackObservation } from "../feedback-types.js";
import type { EditAccess } from "../testing/types.js";
import type {
	ActionOutcome,
	ActionProjection,
	ActionSnapshot,
	Availability,
	CommandDescriptor,
	DataClient,
	EditDescriptor,
	QueryDescriptor,
	QueryResult,
	Values,
} from "../types.js";

export interface QueryInspection {
	id: string;
	descriptor: QueryDescriptor;
	subscribers: number;
	result?: QueryResult;
}
export interface CommandInspection {
	id: string;
	descriptor: CommandDescriptor;
	subscribers: number;
	availability: Availability;
}
export interface EditInspection {
	id: string;
	descriptor: EditDescriptor;
	fields: readonly string[];
	status: "preparing" | "ready" | "failed";
	etag?: string | null;
	message?: string;
}
export interface InspectionSnapshot {
	revision: number;
	mode: "live" | "scenario";
	queries: readonly QueryInspection[];
	commands: readonly CommandInspection[];
	edits: readonly EditInspection[];
	actions: readonly ActionSnapshot[];
}
export interface ClientInspector {
	client: DataClient;
	subscribe(listener: () => void): () => void;
	getSnapshot(): InspectionSnapshot;
	// Detach inspection without closing the wrapped client.
	close(): void;
}
export interface FieldControl {
	label?: string;
	kind?: "string" | "number" | "boolean" | "object" | "array";
	choices?: readonly unknown[];
}
export interface ResourceScenarios {
	name: string;
	fields: readonly string[];
	inScope?(
		identity: unknown,
		scope: unknown,
		values: Readonly<Values>,
	): boolean | "unknown";
	example?: { identity: unknown; scope?: unknown; data: object };
	controls?: Readonly<Record<string, FieldControl>>;
	commands?: Readonly<
		Record<
			string,
			{
				input?: unknown;
				availability?: Availability;
				outcome?: ActionOutcome;
				proposals?:
					| readonly ActionProjection[]
					| ((command: CommandDescriptor) => readonly ActionProjection[]);
			}
		>
	>;
	edits?: Readonly<Record<string, { values: object; outcome?: ActionOutcome }>>;
}
export interface QueryScenario {
	state: "ready" | "loading" | "empty" | "partial" | "failed" | "denied";
	values?: Values;
	rows?: readonly { identity: unknown; data: Values }[];
	missing?: readonly string[];
	delayMs?: number;
	message?: string;
}
export interface CommandScenario {
	availability?: Availability;
	outcome?: ActionOutcome;
	pending?: boolean;
	proposals?: readonly ActionProjection[];
}
export interface EditScenario extends EditAccess<Values> {
	values?: Values;
	externalChange?: boolean;
}
export interface ScenarioFeedback extends FeedbackClient {
	subscribe(listener: () => void): () => void;
	getSnapshot(): readonly string[];
	claim(ids: readonly string[]): () => void;
	claimQuery<T extends object, I>(query: QueryDescriptor<T, I>): () => void;
	acknowledge(id: string, action?: FeedbackObservation): void;
}
export interface ScenarioClient extends ClientInspector {
	readonly resources: readonly ResourceScenarios[];
	readonly feedback: ScenarioFeedback;
	setQuery(id: string, scenario: QueryScenario): void;
	setCommand(id: string, scenario: CommandScenario): void;
	canAdvance(actionId: string): boolean;
	progress(
		actionId: string,
		progress: NonNullable<ActionSnapshot["progress"]>,
	): boolean;
	settle(actionId: string, outcome: ActionOutcome): boolean;
	setEdit(id: string, scenario: EditScenario): void;
}
