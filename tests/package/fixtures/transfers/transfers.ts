// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { installBackgroundTransfers } from "@hyecompany/vem-data/worker";
import { channel, databaseName } from "./config.js";

installBackgroundTransfers({ databaseName, channel });
