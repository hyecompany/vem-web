// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { DataClient } from "../types.js";

export function delegateClient(
	client: DataClient,
	overrides: Partial<DataClient>,
): DataClient {
	return new Proxy(client, {
		get(target, property) {
			const value =
				Reflect.get(overrides, property) ?? Reflect.get(target, property);
			return typeof value === "function"
				? value.bind(property in overrides ? overrides : target)
				: value;
		},
	});
}
