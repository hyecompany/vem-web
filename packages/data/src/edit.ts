// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { proofEvery } from "./access-proofs.js";
import { evaluateAccess } from "./read-model/access-requirements.js";
import type {
	ActionHandle,
	ActionOutcome,
	CommandResult,
	DataClient,
	DisclosureProof,
	EditDescriptor,
	PreparedEdit,
} from "./types.js";

export interface EditSnapshot<
	T extends object,
	O extends ActionOutcome = ActionOutcome,
> {
	status: "loading" | "ready" | "error" | "restricted";
	values: Readonly<Partial<T>>;
	dirty: boolean;
	saving: boolean;
	canSave: boolean;
	reason?: string;
	outcome?: CommandResult<O>;
	missing: readonly (keyof T & string)[];
}

export class EditSession<
	T extends object,
	O extends ActionOutcome = ActionOutcome,
> {
	#client: DataClient;
	#descriptor: EditDescriptor<T, unknown, O>;
	#prepared?: PreparedEdit<T, O>;
	#snapshot: EditSnapshot<T, O> = {
		status: "loading",
		values: {} as Partial<T>,
		dirty: false,
		saving: false,
		canSave: false,
		missing: [],
	};
	#listeners = new Set<() => void>();
	#stop?: () => void;
	#load = 0;
	#version = 0;
	#started = false;
	#preparing = false;
	#draft: Partial<T> = {};
	#needsBaseline = false;
	#prepareError?: string;

	constructor(client: DataClient, descriptor: EditDescriptor<T, unknown, O>) {
		this.#client = client;
		this.#descriptor = descriptor;
	}
	getSnapshot = () => this.#snapshot;
	subscribe = (listener: () => void) => {
		this.#listeners.add(listener);
		if (!this.#stop)
			this.#stop = this.#client.subscribe(() => this.#accessChanged());
		if (!this.#started) {
			this.#started = true;
			void this.reload();
		}
		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) this.dispose();
		};
	};
	#publish(update: Partial<EditSnapshot<T, O>>) {
		this.#snapshot = { ...this.#snapshot, ...update };
		for (const listener of this.#listeners) listener();
	}
	#accessChanged() {
		const prepared = this.#prepared;
		if (!prepared) return;
		const access = this.#client.accessSnapshot();
		const ownerChanged = prepared.ownerEpoch !== access.epoch;
		const contextChanged = prepared.contextId !== access.contextId;
		const contextRetired =
			(access.retiredContexts?.[prepared.contextId] ?? -1) >=
			prepared.accessGeneration;
		if (ownerChanged || contextChanged) {
			this.#needsBaseline = true;
			this.#prepared = { ...prepared, baseline: undefined, etag: null };
		}
		const values = { ...this.#draft };
		const baselineValues = { ...prepared.values };
		const removed = new Set(this.#snapshot.missing);
		for (const [name, proof] of Object.entries(
			prepared.fieldDisclosure as Readonly<
				Record<string, DisclosureProof | undefined>
			>,
		)) {
			const field = name as keyof T & string;
			if (!proof) continue;
			const visible = proofEvery(proof, (ref) => {
				const scope = ref.scope;
				const grant = access.scopes[scope];
				return (
					grant?.state === "allowed" &&
					grant.generation === ref.generation &&
					(!ownerChanged || scope === "public") &&
					(!contextChanged ||
						grant.contextIndependent === true ||
						scope === "public")
				);
			});
			if (!visible) {
				delete values[field];
				const surviving = proofEvery(proof, (ref) => {
					const scope = ref.scope;
					const grant = access.scopes[scope];
					return !(
						(ownerChanged && scope !== "public") ||
						(contextRetired &&
							scope !== "public" &&
							grant?.contextIndependent !== true) ||
						grant?.state === "denied" ||
						(grant && grant.generation !== ref.generation)
					);
				});
				if (!surviving) {
					delete this.#draft[field];
					delete baselineValues[field];
					removed.add(field);
				}
			}
		}
		const writeDenied =
			evaluateAccess(prepared.writeAccess, (scope) =>
				this.#client.access(scope),
			) === "denied";
		if (removed.size > 0) {
			this.#prepared = {
				...prepared,
				values: baselineValues,
				baseline: undefined,
				etag: null,
			};
			this.#publish({
				status: "restricted",
				values,
				missing: [...removed],
				canSave: false,
				outcome: undefined,
				reason:
					"Some fields are no longer available. Reload an authorized baseline before saving.",
			});
			return;
		}
		if (Object.keys(values).length !== Object.keys(this.#draft).length) {
			this.#publish({
				status: "restricted",
				values,
				canSave: false,
				outcome: undefined,
				reason: "Waiting for access to be established",
			});
			return;
		}
		if (this.#preparing) return;
		if (this.#prepareError !== undefined) {
			this.#publish({
				status: "error",
				values,
				canSave: false,
				reason: this.#prepareError,
			});
			return;
		}
		const canSave =
			!writeDenied &&
			!this.#needsBaseline &&
			!this.#snapshot.saving &&
			this.#snapshot.dirty;
		if (
			canSave !== this.#snapshot.canSave ||
			writeDenied ||
			this.#snapshot.status === "restricted" ||
			(this.#needsBaseline && !this.#snapshot.reason)
		)
			this.#publish({
				status: "ready",
				values,
				canSave,
				reason: writeDenied
					? "Write access is unavailable"
					: this.#needsBaseline
						? "Review the outcome and reload the current baseline before saving again."
						: undefined,
			});
	}
	reload(): Promise<void> {
		return this.#prepare(false);
	}
	async #prepare(retainOutcome: boolean): Promise<void> {
		const generation = ++this.#load;
		this.#preparing = true;
		this.#publish({
			status: "loading",
			canSave: false,
			reason: undefined,
			outcome: retainOutcome ? this.#snapshot.outcome : undefined,
		});
		try {
			const prepared = await this.#client.prepareEdit(this.#descriptor);
			if (generation !== this.#load) return;
			this.#preparing = false;
			this.#prepared = prepared;
			this.#prepareError = undefined;
			this.#needsBaseline = false;
			this.#draft = structuredClone(prepared.values);
			this.#version++;
			const next: EditSnapshot<T, O> = {
				status: "ready",
				values: this.#draft,
				dirty: false,
				saving: false,
				missing: [],
				canSave: false,
				outcome: retainOutcome ? this.#snapshot.outcome : undefined,
			};
			this.#snapshot = next;
			this.#accessChanged();
			if (this.#snapshot === next) this.#publish({});
		} catch (error) {
			if (generation === this.#load) {
				this.#preparing = false;
				this.#prepareError =
					error instanceof Error ? error.message : String(error);
				this.#publish({
					status: "error",
					canSave: false,
					reason: this.#prepareError,
				});
			}
		}
	}
	set<K extends keyof T>(field: K, value: T[K]): void {
		this.#accessChanged();
		if (
			this.#snapshot.status !== "ready" ||
			this.#snapshot.missing.includes(field as keyof T & string)
		)
			throw new Error("This field is not currently editable");
		this.#version++;
		const values = {
			...this.#snapshot.values,
			[field]: structuredClone(value),
		};
		this.#draft = values;
		const dirty =
			JSON.stringify(values) !== JSON.stringify(this.#prepared?.values);
		this.#publish({
			values,
			dirty,
			outcome:
				this.#snapshot.outcome?.kind === "succeeded"
					? undefined
					: this.#snapshot.outcome,
		});
		this.#accessChanged();
	}
	save(): ActionHandle<CommandResult<O>> {
		this.#accessChanged();
		if (!this.#prepared || !this.#snapshot.canSave)
			throw new Error(
				this.#snapshot.reason ?? "The draft is not ready to save",
			);
		const version = this.#version;
		const generation = this.#load;
		const action = this.#client.saveEdit(
			this.#prepared,
			this.#snapshot.values as T,
		);
		this.#publish({ saving: true, canSave: false, outcome: undefined });
		void action.result.then(async (outcome) => {
			if (generation !== this.#load) return;
			if (
				outcome.kind === "partial" ||
				outcome.kind === "unknown" ||
				(outcome.kind === "succeeded" && version !== this.#version) ||
				(outcome.kind === "failed" && outcome.error.code === "conflict")
			)
				this.#needsBaseline = true;
			this.#publish({ saving: false, outcome });
			this.#accessChanged();
			if (this.#snapshot.status !== "ready") return;
			if (outcome.kind === "succeeded" && version === this.#version)
				await this.#prepare(true);
			else if (this.#needsBaseline)
				this.#publish({
					canSave: false,
					reason:
						"Review the outcome and reload the current baseline before saving again.",
				});
			else this.#accessChanged();
		});
		return action;
	}
	dispose(): void {
		this.#load++;
		this.#preparing = false;
		this.#stop?.();
		this.#stop = undefined;
		this.#listeners.clear();
		this.#prepared = undefined;
		this.#prepareError = undefined;
		this.#draft = {};
		this.#needsBaseline = false;
		this.#snapshot = {
			status: "loading",
			values: {} as Partial<T>,
			dirty: false,
			saving: false,
			canSave: false,
			missing: [],
		};
		this.#started = false;
	}
}
