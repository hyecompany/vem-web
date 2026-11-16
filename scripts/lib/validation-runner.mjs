// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/** Execute prerequisites once per invocation, including shared concurrent dependencies. */
export function createTaskRunner(tasks) {
	const running = new Map();
	return function execute(name) {
		if (running.has(name)) return running.get(name);
		const task = tasks[name];
		if (!task) throw Error(`Unknown validation task: ${name}`);
		const result = Promise.resolve().then(async () => {
			for (const dependency of task.needs ?? []) await execute(dependency);
			await task.run?.();
		});
		running.set(name, result);
		return result;
	};
}
