// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/** Reverse truth dependencies; missing inputs retain their incoming edges until their consumers leave. */
export class EvidenceDependencies {
	private readonly forward = new Map<string, ReadonlySet<string>>();
	private readonly reverse = new Map<string, Set<string>>();
	private readonly order = new Map<string, number>();
	private sequence = 0;

	set(key: string, dependencies: Iterable<string>): void {
		if (!this.order.has(key)) this.order.set(key, this.sequence++);
		const next = new Set(dependencies);
		const previous = this.forward.get(key);
		for (const dependency of previous ?? []) {
			if (next.has(dependency)) continue;
			this.unlink(dependency, key);
		}
		for (const dependency of next) {
			if (previous?.has(dependency)) continue;
			let dependents = this.reverse.get(dependency);
			if (!dependents) {
				dependents = new Set();
				this.reverse.set(dependency, dependents);
			}
			dependents.add(key);
		}
		if (next.size) this.forward.set(key, next);
		else this.forward.delete(key);
	}

	delete(key: string): void {
		for (const dependency of this.forward.get(key) ?? [])
			this.unlink(dependency, key);
		this.forward.delete(key);
		this.order.delete(key);
	}

	private unlink(dependency: string, key: string): void {
		const dependents = this.reverse.get(dependency);
		dependents?.delete(key);
		if (dependents?.size === 0) this.reverse.delete(dependency);
	}

	direct(keys: Iterable<string>): readonly string[] {
		const dependents = new Set<string>();
		for (const key of keys)
			for (const dependent of this.reverse.get(key) ?? [])
				dependents.add(dependent);
		return this.ordered(dependents);
	}

	affected(keys: Iterable<string>): readonly string[] {
		const affected = new Set(keys);
		for (const key of affected)
			for (const dependent of this.reverse.get(key) ?? [])
				affected.add(dependent);
		return this.ordered(affected);
	}

	private ordered(keys: Iterable<string>): readonly string[] {
		// Preserve the cell visitation order used by conservative cycle evaluation.
		return [...keys].sort(
			(a, b) => (this.order.get(a) ?? -1) - (this.order.get(b) ?? -1),
		);
	}

	clear(): void {
		this.forward.clear();
		this.reverse.clear();
		this.order.clear();
		this.sequence = 0;
	}
}
