// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
import { protocolVersion } from "@hyecompany/vem-data/client";
import { persistenceSchemaVersion } from "@hyecompany/vem-data/runtime";
export const databaseName = "vem-native-transfer-integration";
export const channel = "vem-native-transfer-integration";
export const compatibility = {
	protocol: protocolVersion,
	schema: persistenceSchemaVersion,
	definitions: 1,
	build: "transfer-fixture-1",
};
