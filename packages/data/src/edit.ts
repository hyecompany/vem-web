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

/** A readable unset field is distinct from a loading, withdrawn, or undeclared field. */
export type EditField<V> =
	| {
			state: "readable";
			value: V | undefined;
			canEdit: boolean;
			reason?: string;
			setValue(value: V): void;
	  }
	| {
			state: "loading" | "restricted" | "unavailable";
			canEdit: false;
			reason: string;
	  };

export interface EditSnapshot<
	T extends object,
	O extends ActionOutcome = ActionOutcome,
> {
	status: "loading" | "ready" | "error" | "restricted";
	values: Readonly<Partial<T>>;
	dirty: boolean;
	saving: boolean;
	canSave: boolean;
	/** At least one readable field accepts input; saving admission is independent. */
	canEdit: boolean;
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
		canEdit: false,
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
	#unreadable = new Set<keyof T & string>();

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
		const canEdit =
			!this.#preparing &&
			this.#prepared !== undefined &&
			Object.keys(this.#prepared.fieldDisclosure).some(
				(field) =>
					!this.#unreadable.has(field as keyof T & string) &&
					!(update.missing ?? this.#snapshot.missing).includes(
						field as keyof T & string,
					),
			);
		this.#snapshot = { ...this.#snapshot, canEdit, ...update };
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
		this.#unreadable = new Set();
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
				this.#unreadable.add(field);
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
		if (this.#unreadable.size > 0) {
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
		const reason = writeDenied
			? "Write access is unavailable"
			: this.#needsBaseline
				? "Review the outcome and reload the current baseline before saving again."
				: undefined;
		if (
			reason !== this.#snapshot.reason ||
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
				canEdit: Object.keys(prepared.fieldDisclosure).length > 0,
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
	field<K extends keyof T & string>(name: K): EditField<T[K]> {
		if (!this.#prepared)
			return {
				state: this.#snapshot.status === "loading" ? "loading" : "unavailable",
				canEdit: false,
				reason: this.#snapshot.reason ?? "The edit baseline is not available",
			};
		if (!Object.hasOwn(this.#prepared.fieldDisclosure, name))
			return {
				state: "unavailable",
				canEdit: false,
				reason: "This field is not declared by the edit representation",
			};
		if (this.#unreadable.has(name) || this.#snapshot.missing.includes(name))
			return {
				state: "restricted",
				canEdit: false,
				reason: "Read access to this field is unavailable",
			};
		return {
			state: "readable",
			value: this.#snapshot.values[name],
			canEdit: !this.#preparing,
			reason: this.#preparing ? "The edit baseline is loading" : undefined,
			setValue: (value) => this.set(name, value),
		};
	}
	set<K extends keyof T>(field: K, value: T[K]): void {
		this.#accessChanged();
		if (!this.field(field as keyof T & string).canEdit)
			throw new Error("This field is not currently editable");
		this.#version++;
		const values = {
			...this.#draft,
			[field]: structuredClone(value),
		};
		this.#draft = values;
		const dirty =
			JSON.stringify(values) !== JSON.stringify(this.#prepared?.values);
		this.#publish({
			values: Object.fromEntries(
				Object.entries(values).filter(
					([key]) => !this.#unreadable.has(key as keyof T & string),
				),
			) as unknown as Partial<T>,
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
		this.#unreadable.clear();
		this.#snapshot = {
			status: "loading",
			values: {} as Partial<T>,
			dirty: false,
			saving: false,
			canSave: false,
			canEdit: false,
			missing: [],
		};
		this.#started = false;
	}
}
