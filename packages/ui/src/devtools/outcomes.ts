// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionOutcome } from "@hyecompany/vem-data";
export const outcomeKinds = [
	"succeeded",
	"partial",
	"failed",
	"unknown",
] as const;

export function scenarioOutcome(kind: ActionOutcome["kind"]): ActionOutcome {
	switch (kind) {
		case "succeeded":
			return { kind };
		case "partial":
			return {
				kind,
				value: { simulated: true },
				message: "Simulated partial completion; review the affected resources.",
			};
		case "failed":
			return { kind, error: { message: "Simulated command failure" } };
		case "unknown":
			return {
				kind,
				message:
					"Submission may have succeeded. Its outcome cannot be established.",
			};
	}
}
