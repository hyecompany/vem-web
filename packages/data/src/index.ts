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
export type { TransferExecution } from "./transfer-types.js";
export type {
	AccessSnapshot,
	AccessState,
	ActionHandle,
	ActionOutcome,
	ActionPhase,
	ActionSnapshot,
	Availability,
	CommandDescriptor,
	CommandResult,
	DataClient,
	EditDescriptor,
	FieldInfo,
	PreparedEdit,
	QueryDescriptor,
	QueryHandle,
	QueryIssue,
	QueryResult,
	QueryRow,
	RowIdentity,
	Watch,
} from "./types.js";
