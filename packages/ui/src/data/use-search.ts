// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { QueryDescriptor } from "@hyecompany/vem-data";
import { type UseQueryOptions, useQuery } from "@hyecompany/vem-data/react";
import { useState } from "react";

/** Keep search text beside an ordinary query result; the query factory describes matching information without acquiring it. */
export function useSearch<T extends object, I>(
	queryForText: (text: string) => QueryDescriptor<T, I>,
	options: UseQueryOptions = {},
) {
	const [value, setValue] = useState("");
	const result = useQuery(queryForText(value), options);
	return { value, setValue, result };
}
