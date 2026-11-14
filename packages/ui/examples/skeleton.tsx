// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { Skeleton } from "@hyecompany/vem-ui";
export function SkeletonExample() {
	return (
		<section
			aria-busy="true"
			aria-label="Loading task summary"
			style={{ display: "grid", gap: "0.5rem", maxWidth: "18rem" }}
		>
			<Skeleton
				aria-hidden="true"
				style={{ height: "1.25rem", width: "70%" }}
			/>
			<Skeleton aria-hidden="true" style={{ height: "0.75rem" }} />
			<Skeleton
				aria-hidden="true"
				style={{ height: "0.75rem", width: "85%" }}
			/>
		</section>
	);
}
// #endregion example
