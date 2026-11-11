// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import type {
	ContinuityProof,
	ContinuityRef,
	FieldLiveness,
	ObservationLiveness,
} from "../types.js";

interface ContinuityState {
	generation: number;
	live: boolean;
}
export type ContinuitySnapshot = ReadonlyMap<string, ContinuityState>;
const continuityKey = (ref: ContinuityRef) =>
	stableKey([ref.channel, ref.scope]);
export interface Currency {
	liveness: FieldLiveness;
	stale: boolean;
}
export function continuityRoute(proof: ContinuityProof): ObservationLiveness {
	if (typeof proof === "string") return proof;
	if ("all" in proof) return { all: proof.all.map(continuityRoute) };
	if ("any" in proof) return { any: proof.any.map(continuityRoute) };
	return {
		channel: proof.channel,
		...(proof.scope === undefined ? {} : { scope: proof.scope }),
	};
}

export function combineCurrency(
	values: readonly Currency[],
	mode: "all" | "any",
): Currency {
	const usable = values.filter((value) => !value.stale);
	const stale =
		mode === "all" ? usable.length !== values.length : usable.length === 0;
	const candidates = mode === "all" ? values : usable;
	const immutable =
		mode === "all"
			? candidates.every((value) => value.liveness === "immutable")
			: candidates.some((value) => value.liveness === "immutable");
	const live =
		mode === "all"
			? candidates.every((value) => value.liveness !== "snapshot")
			: candidates.some((value) => value.liveness === "live");
	return {
		liveness: stale
			? "snapshot"
			: immutable
				? "immutable"
				: live
					? "live"
					: "snapshot",
		stale,
	};
}

export class ContinuityRegistry {
	private readonly epoch = crypto.randomUUID();
	private readonly states = new Map<string, ContinuityState>();
	snapshot(): ContinuitySnapshot {
		return new Map(this.states);
	}
	set(ref: ContinuityRef, state: "live" | "interrupted"): boolean {
		const key = continuityKey(ref);
		const previous = this.states.get(key);
		const live = state === "live";
		if (previous?.live === live) return false;
		this.states.set(key, { generation: (previous?.generation ?? 0) + 1, live });
		return true;
	}
	capture(
		value: ObservationLiveness = "snapshot",
		snapshot = this.snapshot(),
	): ContinuityProof {
		if (typeof value === "string") return value;
		if ("all" in value)
			return { all: value.all.map((part) => this.capture(part, snapshot)) };
		if ("any" in value)
			return { any: value.any.map((part) => this.capture(part, snapshot)) };
		const state = snapshot.get(continuityKey(value));
		return {
			...structuredClone(value),
			epoch: this.epoch,
			generation: state?.generation ?? 0,
			live: state?.live ?? false,
		};
	}
	currency(proof: ContinuityProof): Currency {
		if (typeof proof === "string") return { liveness: proof, stale: false };
		if ("all" in proof)
			return combineCurrency(
				proof.all.map((part) => this.currency(part)),
				"all",
			);
		if ("any" in proof)
			return combineCurrency(
				proof.any.map((part) => this.currency(part)),
				"any",
			);
		const state = this.states.get(continuityKey(proof));
		const stale =
			proof.epoch !== this.epoch ||
			proof.generation !== (state?.generation ?? 0);
		return {
			liveness: !stale && proof.live && state?.live ? "live" : "snapshot",
			stale,
		};
	}
	uses(proof: ContinuityProof, ref: ContinuityRef): boolean {
		if (typeof proof === "string") return false;
		if ("all" in proof) return proof.all.some((part) => this.uses(part, ref));
		if ("any" in proof) return proof.any.some((part) => this.uses(part, ref));
		return (
			proof.channel === ref.channel &&
			stableKey(proof.scope) === stableKey(ref.scope)
		);
	}
	clear(): void {
		this.states.clear();
	}
}
