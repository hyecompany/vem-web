// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryIssue } from "./types.js";

/** A source failure with an explicit consumer-facing classification; ordinary thrown errors become read issues. */
export class AcquisitionError extends Error {
	/** Describes this unsuccessful attempt, without changing authority, withdrawing facts, or preventing explicit retry. */
	readonly issue: Readonly<QueryIssue>;

	constructor(issue: QueryIssue, options?: ErrorOptions) {
		super(issue.message, options);
		this.name = "AcquisitionError";
		this.issue = Object.freeze({ ...issue });
	}
}
