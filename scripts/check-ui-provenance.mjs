// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { sources } from "./lib/ui-upstream.mjs";

const tracked = await sources();
console.log(
	`Checked attribution and pinned source comments for ${tracked.length} upstream files.`,
);
