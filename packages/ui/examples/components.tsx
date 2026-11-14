// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region imports
import { OverflowText, Spinner } from "@hyecompany/vem-ui";
import "@hyecompany/vem-ui/styles.css";
// #endregion imports

// #region overflow
export function FileName() {
	return (
		<OverflowText
			text="quarterly-research-report-final.pdf"
			style={{ maxWidth: "12rem" }}
		/>
	);
}
// #endregion overflow

// #region parent-trigger
export function ProjectButton() {
	return (
		<button
			type="button"
			data-vem-overflow-trigger=""
			style={{ maxWidth: "12rem" }}
		>
			<OverflowText text="development-services-europe" />
		</button>
	);
}
// #endregion parent-trigger

// #region spinner
export function SavingIndicator() {
	return <Spinner size="sm" aria-label="Saving changes" />;
}
// #endregion spinner
