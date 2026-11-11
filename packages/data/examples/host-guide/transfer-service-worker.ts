// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region transfer-worker
import { installBackgroundTransfers } from "@hyecompany/vem-data/worker";
import { transferHost } from "./transfer-config.js";

installBackgroundTransfers(transferHost);
// #endregion transfer-worker
