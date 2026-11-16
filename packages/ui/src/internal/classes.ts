// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

export function classes(
	...values: (string | false | null | undefined)[]
): string {
	return values.filter(Boolean).join(" ");
}
