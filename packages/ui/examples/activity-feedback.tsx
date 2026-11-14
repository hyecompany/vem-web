// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region example
import { ActivityFeedback } from "@hyecompany/vem-ui/data";

export function TaskProgress({ actionId }: { actionId: string }) {
	return <ActivityFeedback actionIds={[actionId]} label="Completing task" />;
}
// #endregion example
