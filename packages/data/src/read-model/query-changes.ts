// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

export class QueryChanges {
	revision = 0;
	private readonly frames: { revision: number; keys: readonly string[] }[] = [];
	reset(): void {
		this.frames.length = 0;
		this.revision++;
	}
	changed(keys: Iterable<string>): void {
		const unique = [...new Set(keys)];
		if (unique.length === 0) return;
		this.frames.push({ revision: ++this.revision, keys: unique });
		if (this.frames.length > 64) this.frames.shift();
	}
	since(revision: number): ReadonlySet<string> | undefined {
		if (revision === this.revision) return new Set();
		if (revision < (this.frames[0]?.revision ?? this.revision) - 1)
			return undefined;
		const keys = new Set<string>();
		for (const frame of this.frames)
			if (frame.revision > revision)
				for (const key of frame.keys) keys.add(key);
		return keys;
	}
}
