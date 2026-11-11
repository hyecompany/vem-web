// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	ActionOutcome,
	CommandDescriptor,
	CommandResult,
	EditDescriptor,
	QueryDescriptor,
	QueryRow,
	Values,
} from "./types.js";

export function query<T extends object = Values, I = unknown>(
	value: Omit<QueryDescriptor<T, I>, "kind">,
): QueryDescriptor<Partial<T>, I> {
	return freezeValue({
		...structuredClone(value),
		kind: "query",
		select: [...new Set(value.select)].sort(),
	});
}

export function freezeValue<T>(value: T): T {
	if (
		value &&
		typeof value === "object" &&
		!Object.isFrozen(value) &&
		(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)
	) {
		for (const child of Object.values(value)) freezeValue(child);
		Object.freeze(value);
	}
	return value;
}
export function command<
	Input = unknown,
	Outcome extends ActionOutcome = ActionOutcome,
>(
	value: Omit<CommandDescriptor<Input, Outcome>, "kind">,
): CommandDescriptor<Input, CommandResult<Outcome>> {
	return freezeValue({ ...captureValue(value), kind: "command" });
}
export function edit<
	T extends object = Values,
	I = unknown,
	O extends ActionOutcome = ActionOutcome,
>(
	value: Omit<EditDescriptor<T, I, O>, "kind">,
): EditDescriptor<T, I, CommandResult<O>> {
	return freezeValue({ ...captureValue(value), kind: "edit" });
}
function captureValue<T>(value: T): T {
	if (Array.isArray(value)) return value.map(captureValue) as T;
	if (
		value &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	)
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, captureValue(child)]),
		) as T;
	return value;
}
export function hasFields<T extends object, I, K extends keyof T & string>(
	row: QueryRow<T, I>,
	...fields: readonly K[]
): row is QueryRow<T, I> & { data: Readonly<Partial<T> & Pick<T, K>> } {
	return fields.every((field) => Object.hasOwn(row.fields, field));
}
export function fieldInfo<T extends object, I>(
	row: QueryRow<T, I>,
	field: keyof T,
) {
	return row.fields[field];
}
export function stableKey(value: unknown): string {
	if (value === undefined) return "u";
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new TypeError("Descriptor numbers must be finite");
		return String(value);
	}
	if (typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
	if (
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) => `${JSON.stringify(key)}:${stableKey((value as Values)[key])}`,
			)
			.join(",")}}`;
	}
	throw new TypeError(
		"Query identities and scopes must contain only plain serializable values",
	);
}

const transientFiles = new WeakMap<Blob, string>();
export function commandKey(value: unknown, transferId?: string): string {
	if (typeof Blob !== "undefined" && value instanceof Blob) {
		let id = transferId ?? transientFiles.get(value);
		if (!id) {
			id = globalThis.crypto.randomUUID();
			transientFiles.set(value, id);
		}
		return stableKey({ blob: id, size: value.size, type: value.type });
	}
	if (Array.isArray(value))
		return `[${value.map((entry) => commandKey(entry, transferId)).join(",")}]`;
	if (value && typeof value === "object") {
		const input = value as Values;
		const transfer =
			typeof input.transferId === "string" ? input.transferId : transferId;
		return `{${Object.keys(input)
			.sort()
			.map(
				(key) => `${JSON.stringify(key)}:${commandKey(input[key], transfer)}`,
			)
			.join(",")}}`;
	}
	return stableKey(value);
}
