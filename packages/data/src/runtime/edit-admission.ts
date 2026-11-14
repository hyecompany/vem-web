// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { AccessRegistry } from "../access.js";
import { captureBasis, captureProof, proofEvery } from "../access-proofs.js";
import {
	evaluateAccess,
	fieldAccess,
} from "../read-model/access-requirements.js";
import type {
	AccessState,
	ActionHandle,
	ActionOutcome,
	CommandDescriptor,
	CommandResult,
	DisclosureProof,
	EditDescriptor,
	PreparedEdit,
	QueryDescriptor,
	QueryHandle,
	QueryIssue,
	QueryResult,
	ResourceContext,
	ResourceDefinition,
	Values,
} from "../types.js";
import type { AcquisitionQueue } from "./acquisition.js";

interface EditHost {
	grants: AccessRegistry;
	definitions: ReadonlyMap<string, ResourceDefinition>;
	acquisitions: AcquisitionQueue;
	readonly closed: boolean;
	access(scope: string): AccessState;
	context(signal: AbortSignal): ResourceContext;
	read(
		query: QueryDescriptor,
		options?: { signal?: AbortSignal },
	): Promise<QueryResult>;
	readAvailable(query: QueryDescriptor): boolean;
	accessIssue(query: QueryDescriptor): QueryIssue | undefined;
	peekQuery(query: QueryDescriptor): QueryResult | undefined;
	watch(query: QueryDescriptor): QueryHandle;
	run(
		command: CommandDescriptor,
		options?: { id?: string; origin?: string },
	): ActionHandle;
}
export class EditAdmission {
	constructor(private readonly host: EditHost) {}
	private async readPrerequisite(
		query: QueryDescriptor,
		signal: AbortSignal,
	): Promise<QueryResult> {
		const previous = this.host.peekQuery(query);
		if (!previous?.settled || this.host.readAvailable(query))
			return this.host.read(query, { signal });
		const handle = this.host.watch(query);
		try {
			return await handle.retry();
		} finally {
			handle.dispose();
		}
	}
	async prepare<T extends object, O extends ActionOutcome = ActionOutcome>(
		descriptor: EditDescriptor<T, unknown, O>,
	): Promise<PreparedEdit<T, O>> {
		const definition = this.host.definitions.get(descriptor.resource)?.edits?.[
			descriptor.name
		];
		if (!definition) throw new Error("Unknown edit representation");
		const contextGeneration = this.host.grants.contextGeneration;
		const capturedAccess = this.host.grants.snapshot();
		if (this.host.closed) throw new Error("Runtime closed");
		const controller = new AbortController();
		const canDisclose = this.host.grants.errorGuard();
		let prerequisites: readonly QueryDescriptor[] = [];
		try {
			prerequisites =
				definition.readPrerequisites?.(
					descriptor as EditDescriptor,
					this.host.context(controller.signal),
				) ?? [];
			for (const query of prerequisites) {
				const issue = this.host.accessIssue(query);
				if (issue)
					throw new Error("Read access required for this editor was revoked.");
			}
			const results = await Promise.all(
				prerequisites.map((query) =>
					this.readPrerequisite(query, controller.signal),
				),
			);
			for (const [index, result] of results.entries()) {
				const query = prerequisites[index];
				if (
					!query ||
					!this.host.readAvailable(query) ||
					!result.confirmed.complete ||
					result.unresolved.length ||
					result.issues.length
				)
					throw new Error(
						result.issues[0]?.message ??
							"Required edit information is incomplete; retry preparation",
					);
			}
		} catch (error) {
			throw canDisclose()
				? error
				: new Error("Read access changed while preparing the edit");
		} finally {
			controller.abort();
		}
		return new Promise<PreparedEdit<T, O>>((resolve, reject) => {
			this.host.acquisitions.enqueue(async (context) => {
				if (
					contextGeneration !== this.host.grants.contextGeneration ||
					this.host.closed
				)
					throw new Error("Access changed before preparing the edit");
				if (prerequisites.some((query) => !this.host.readAvailable(query)))
					throw new Error(
						"Required edit information changed before preparation; retry preparation",
					);
				const abort = () => reject(new Error("Edit preparation was canceled"));
				context.signal.addEventListener("abort", abort, { once: true });
				try {
					const prepared = await definition.prepare(
						descriptor as EditDescriptor,
						context,
					);
					if (
						contextGeneration !== this.host.grants.contextGeneration ||
						this.host.closed ||
						context.signal.aborted
					)
						throw new Error("Access context changed while preparing the edit");
					const resource = this.host.definitions.get(descriptor.resource);
					const fieldDisclosure: Record<string, DisclosureProof> = {};
					for (const field of new Set([
						...Object.keys(prepared.values),
						...Object.keys(prepared.fieldDisclosure ?? {}),
					])) {
						const supplied = captureBasis(
							prepared.fieldDisclosure?.[field] ?? prepared.disclosure,
							(scope) => this.host.grants.ref(scope),
						);
						const requirement =
							resource && fieldAccess(resource, field, descriptor.target);
						const proof: DisclosureProof = requirement
							? {
									all: [
										supplied,
										captureProof(requirement, (scope) =>
											this.host.grants.ref(scope),
										),
									],
								}
							: supplied;
						if (
							!proofEvery(proof, (ref) => {
								const current = this.host.grants.ref(ref.scope);
								return (
									current.generation === ref.generation &&
									current.epoch === ref.epoch &&
									current.contextId === ref.contextId &&
									!this.host.grants.revoked({
										...ref,
										generation: Math.min(
											ref.generation,
											capturedAccess.scopes[ref.scope]?.generation ?? 0,
										),
									})
								);
							})
						)
							throw new Error("Read access changed while preparing the edit");
						fieldDisclosure[field] = proof;
					}
					resolve({
						descriptor: prepared.descriptor,
						values: prepared.values,
						etag: prepared.etag,
						baseline: prepared.baseline,
						writeAccess: prepared.writeAccess,
						fieldDisclosure,
						ownerEpoch: this.host.grants.epoch,
						contextId: this.host.grants.contextId,
						accessGeneration: contextGeneration,
					} as PreparedEdit<T, O>);
				} finally {
					context.signal.removeEventListener("abort", abort);
				}
			}, reject);
		});
	}
	save<T extends object, O extends ActionOutcome = ActionOutcome>(
		prepared: PreparedEdit<T, O>,
		values: T,
		options?: { id?: string; origin?: string },
	): ActionHandle<CommandResult<O>> {
		if (
			prepared.contextId !== this.host.grants.contextId ||
			prepared.accessGeneration !== this.host.grants.contextGeneration
		)
			throw new Error("The edit belongs to a retired access context");
		if (prepared.ownerEpoch !== this.host.grants.epoch)
			throw new Error("The edit belongs to a previous runtime owner");
		for (const field of Object.keys(values))
			if (!Object.hasOwn(prepared.fieldDisclosure, field))
				throw new Error("The draft contains an undeclared field");
		for (const [field, proof] of Object.entries(
			prepared.fieldDisclosure as Readonly<
				Record<string, DisclosureProof | undefined>
			>,
		)) {
			if (
				Object.hasOwn(values, field) &&
				proof &&
				!this.host.grants.visible(proof)
			)
				throw new Error("Access to an edited field was revoked");
		}
		if (
			evaluateAccess(prepared.writeAccess, (scope) =>
				this.host.access(scope),
			) === "denied"
		)
			throw new Error("Permission to save this edit was revoked");
		const definition = this.host.definitions.get(prepared.descriptor.resource)
			?.edits?.[prepared.descriptor.name];
		if (!definition) throw new Error("Unknown edit representation");
		return this.host.run(
			definition.command(prepared as PreparedEdit, values as Values),
			options,
		) as ActionHandle<CommandResult<O>>;
	}
}
