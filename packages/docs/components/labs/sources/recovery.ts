// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { ActionOutcome } from "@hyecompany/vem-data";
import {
	createRuntime,
	type ResourceDefinition,
} from "@hyecompany/vem-data/runtime";
import { deferred, MemoryPersistence } from "@hyecompany/vem-data/testing";
import { evidence, target, tasks } from "../model";
export function createRecovery() {
	const persistence = new MemoryPersistence();
	const submitted = deferred<void>();
	const pending = deferred<ActionOutcome>();
	const recovered = deferred<void>();
	let submissions = 0,
		checks = 0,
		closed = false;
	const definition: ResourceDefinition = {
		name: "tasks",
		access: "public",
		persist: () => true,
		commands: {
			complete: {
				access: "public",
				disclosure: "public",
				recovery: () => ({ operation: "weekend-task" }),
				project: () => [
					{
						resource: "tasks",
						identity: target,
						kind: "update",
						values: { status: "done" },
					},
				],
				async run(_command, context) {
					submissions++;
					context.submitted();
					submitted.resolve();
					return pending.promise;
				},
				async recover() {
					checks++;
					recovered.resolve();
					return { kind: "unknown", message: "No reply was recorded." };
				},
			},
		},
	};
	const first = createRuntime({ resources: [definition], persistence });
	first.observe(evidence());
	const owners = [first];
	return {
		client: first,
		counts: () => ({ submissions, checks }),
		async submit() {
			await first.ready;
			if (closed) return;
			first.run(tasks.commands.complete(target));
			await submitted.promise;
			await first.flush();
		},
		async reopen() {
			first.close();
			if (closed) return;
			const next = createRuntime({ resources: [definition], persistence });
			owners.push(next);
			await next.ready;
			await recovered.promise;
			await next.read(tasks.list({ select: ["title", "status"] }));
			if (!closed) return next;
		},
		close() {
			closed = true;
			pending.resolve({ kind: "unknown", message: "Example ended." });
			for (const owner of owners) owner.close();
		},
	};
}
