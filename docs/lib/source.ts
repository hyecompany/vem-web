// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

export const source = loader({
	baseUrl: "/docs",
	source: docs.toFumadocsSource(),
});
