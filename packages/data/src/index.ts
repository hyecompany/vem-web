// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

export type {
	CommandContract,
	EditContract,
	ListArguments,
	QueryOptions,
	ResourceContract,
	ResourceFilter,
	ResourceIdentity,
	ResourceScope,
	ResourceValues,
} from "./contracts.js";
export { defineCommand, defineEdit, defineResource } from "./contracts.js";
export {
	command,
	edit,
	fieldInfo,
	hasFields,
	query,
	stableKey,
} from "./descriptors.js";
export type { EditField, EditSnapshot } from "./edit.js";
export type { FeedbackClient, FeedbackObservation } from "./feedback-types.js";
export type {
	CombinedFilter,
	ContainsFilter,
	EqualFilter,
	FilterCapabilities,
	FilterExpression,
	LogicalFilter,
	TextComparison,
} from "./filters.js";
export {
	filterFields,
	isFilterExpression,
	matchesFilter,
} from "./filters.js";
export type { TransferExecution } from "./transfer-types.js";
export type {
	AccessSnapshot,
	AccessState,
	ActionHandle,
	ActionObservation,
	ActionOutcome,
	ActionPhase,
	ActionSnapshot,
	Availability,
	CommandDescriptor,
	CommandResult,
	DataClient,
	EditDescriptor,
	FieldInfo,
	IdentityTransition,
	IdentityTransitionObservation,
	PreparedEdit,
	QueryDescriptor,
	QueryHandle,
	QueryIssue,
	QueryResult,
	QueryRow,
	QueryWatchOptions,
	ReadStatus,
	ReadStatusHandle,
	RowIdentity,
	Watch,
} from "./types.js";
export type { FieldCondition, TextCondition, Where } from "./where.js";
export { matchesWhere } from "./where.js";
