// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/** Run independent tasks concurrently, sharing prerequisites and draining failures before cleanup. */
export function createTaskRunner(tasks, { concurrency = 2 } = {}) {
	if (!Number.isInteger(concurrency) || concurrency < 1)
		throw Error("Validation concurrency must be a positive integer");
	const running = new Map();
	const waiting = [];
	let active = 0;
	async function run(action) {
		if (active >= concurrency)
			await new Promise((resolve) => waiting.push(resolve));
		else active++;
		try {
			await action();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	}
	return function execute(name) {
		if (running.has(name)) return running.get(name);
		const task = tasks[name];
		if (!task) throw Error(`Unknown validation task: ${name}`);
		const result = Promise.resolve().then(async () => {
			const results = await Promise.allSettled((task.needs ?? []).map(execute));
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length === 1) throw failures[0].reason;
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					`Prerequisites failed: ${name}`,
				);
			if (task.run) await run(task.run);
		});
		running.set(name, result);
		return result;
	};
}
