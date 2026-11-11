// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { stableKey } from "../descriptors.js";
import {
	type MissingRequirement,
	requirementKey,
} from "../read-model/requirements.js";
import type {
	EvidenceRef,
	ObservationResult,
	QueryDescriptor,
	QueryIssue,
	ResourceContext,
	ResourceDefinition,
} from "../types.js";
import { type PlannedAcquisition, planAcquisitions } from "./planning.js";
import { executeSource } from "./source-execution.js";
import type { QueryState } from "./state.js";

interface Work {
	key: string;
	order: number;
	states: QueryState[];
	run(context: ResourceContext): Promise<ObservationResult>;
	fail?(error: unknown): void;
	source?: PlannedAcquisition;
}
interface AcquisitionHost {
	evidenceGeneration?(ref: EvidenceRef): number;
	queries: ReadonlyMap<string, QueryState>;
	needs(state: QueryState): boolean;
	requirements(
		query: QueryDescriptor,
		forcedFields?: readonly string[],
	): readonly MissingRequirement[];
	definition(resource: string): ResourceDefinition;
	accessIssue?(query: QueryDescriptor): QueryIssue | undefined;
	context(signal: AbortSignal): ResourceContext;
	errorGuard(
		states: readonly QueryState[],
		source?: PlannedAcquisition,
	): () => boolean;
	batch(work: () => void): void;
	changed(): void;
}
const message = (error: unknown) =>
	error instanceof Error
		? error.message
		: "The requested information could not be read";
export class AcquisitionQueue {
	private readonly queued = new Map<string, Work>();
	private readonly busy = new Map<string, Work>();
	private readonly cycles = new WeakMap<
		QueryState,
		{
			forced: number;
			through: number;
			finished: boolean;
			authority: string;
			generation: number;
			attempts: PlannedAcquisition[];
		}
	>();
	private readonly controllers = new Set<AbortController>();
	private running = 0;
	private planned = false;
	private closed = false;
	private sequence = 0;
	constructor(
		private readonly host: AcquisitionHost,
		private readonly maxConcurrent: number,
		private readonly maxAcquisitionsPerRead = 4096,
	) {}
	revalidating(
		query: QueryDescriptor,
		requirements: readonly MissingRequirement[],
	): boolean {
		const key = stableKey(query);
		const stale = requirements
			.filter((requirement) => requirement.stale)
			.map(requirementKey);
		return [...this.busy.values()].some((work) => {
			const checking = work.source?.revalidates?.get(key);
			return (
				checking !== undefined &&
				stale.some((requirement) => checking.has(requirement))
			);
		});
	}
	enqueue(run: Work["run"], fail: NonNullable<Work["fail"]>): void {
		const key = `edit:${globalThis.crypto.randomUUID()}`;
		this.queued.set(key, {
			key,
			order: ++this.sequence,
			states: [],
			run,
			fail,
		});
		this.drain();
	}
	schedule(): void {
		if (this.planned || this.closed) return;
		this.planned = true;
		queueMicrotask(() => {
			this.planned = false;
			if (this.closed) return;
			this.planAutomatic();

			this.drain();
		});
	}
	evidence(resources: ReadonlySet<string>): void {
		for (const state of this.host.queries.values()) {
			const definition = this.host.definition(state.descriptor.resource);
			if (
				resources.has(definition.name) ||
				definition.readPrerequisites !== undefined ||
				definition.fieldDependencies !== undefined ||
				definition.membershipDependencies !== undefined ||
				definition.presenceDependencies !== undefined
			)
				state.version++;
		}
	}
	private planAutomatic(): void {
		const all = [...this.host.queries.values()];
		this.host.batch(() => {
			for (const state of all) {
				if (this.host.needs(state)) continue;
				for (const work of [...this.queued.values(), ...this.busy.values()]) {
					if (!work.source) continue;
					const index = work.states.indexOf(state);
					if (index < 0) continue;
					work.states.splice(index, 1);
					state.fetching--;
					this.host.changed();
				}
				const cycle = this.cycles.get(state);
				if (cycle) {
					cycle.finished = true;
					cycle.through = state.version;
					cycle.attempts = [];
				}
				if (state.issues.length) {
					state.issues = [];
					this.host.changed();
				}
			}
		});
		const context = this.host.context(new AbortController().signal);
		const generation = (state: QueryState) =>
			this.host
				.requirements(state.descriptor)
				.reduce(
					(latest, requirement) =>
						Math.max(latest, requirement.generation ?? 0),
					0,
				);
		if (
			!all.some(
				(state) =>
					state.active &&
					this.host.needs(state) &&
					((state.fetching === 0 && state.attempted < state.version) ||
						context.authorityFence !== this.cycles.get(state)?.authority ||
						generation(state) > (this.cycles.get(state)?.generation ?? -1)),
			)
		)
			return;
		const states = all.filter(
			(state) =>
				state.active &&
				this.host.needs(state) &&
				(state.attempted < state.version || state.fetching > 0),
		);
		for (const state of states) {
			const cycle = this.cycles.get(state);
			if (!cycle || cycle.forced !== state.forced)
				this.cycles.set(state, {
					forced: state.forced,
					through: state.version,
					finished: false,
					authority: context.authorityFence,
					generation: generation(state),
					attempts: [],
				});
			else {
				cycle.through = state.version;
				cycle.authority = context.authorityFence;
				cycle.generation = generation(state);
			}
		}
		this.host.batch(() => {
			let order = ++this.sequence;
			for (const [key, work] of this.queued)
				if (work.source) {
					this.queued.delete(key);
					order = Math.min(order, work.order);
					for (const state of work.states) state.fetching--;
				}
			try {
				const inflight = [...this.busy.values()].flatMap((work) =>
					work.source ? [work.source] : [],
				);
				const result = planAcquisitions(
					this.host,
					states,
					this.host.context(new AbortController().signal),
					inflight,
					(state, candidate, requirement) => {
						const attempts = this.cycles.get(state)?.attempts ?? [];
						return (
							attempts.length >= this.maxAcquisitionsPerRead ||
							attempts.some(
								(previous) =>
									previous.baseKey === candidate.baseKey &&
									(requirement.generation ?? 0) <= previous.generation &&
									(candidate.request.mode === "one" ||
										requirement.kind === "membership" ||
										requirement.kind === "collection-field" ||
										previous.seenIdentities.has(
											previous.identityKey(requirement.identity),
										)) &&
									candidate.request.fields.every((field) =>
										previous.request.fields.includes(field),
									) &&
									candidate.request.relationships.every((name) =>
										previous.request.relationships.includes(name),
									),
							)
						);
					},
				);
				for (const work of this.busy.values())
					if (work.source) work.source.revalidates = undefined;
				for (const source of result.waiting) {
					const work = this.busy.get(source.key);
					if (!work) continue;
					if (work.source) work.source.revalidates = source.revalidates;
					for (const state of source.states)
						if (!work.states.includes(state)) {
							work.states.push(state);
							state.fetching++;
							this.cycles.get(state)?.attempts.push(source);
						}
				}
				for (const source of result.work) {
					for (const state of source.states) state.fetching++;
					this.queued.set(source.key, {
						key: source.key,
						order,
						states: source.states,
						source,
						run: (context) =>
							executeSource(source, context, () =>
								source.states.some(
									(state) => state.active && this.host.needs(state),
								),
							),
					});
				}
				for (const state of result.uncovered)
					if (state.fetching === 0) {
						state.attempted = state.version;
						const cycle = this.cycles.get(state);
						if (cycle) {
							cycle.finished = true;
							cycle.through = state.version;
						}
						if (this.host.needs(state) && !state.issues.length)
							state.issues = [
								result.issues.get(state) ?? {
									kind: cycle?.attempts.some((attempt) => attempt.succeeded)
										? "incomplete"
										: "unsupported",
									message:
										(cycle?.attempts.length ?? 0) >= this.maxAcquisitionsPerRead
											? `This read reached its limit of ${this.maxAcquisitionsPerRead} source acquisitions; retry can continue with the remaining information`
											: cycle?.attempts.some((attempt) => attempt.succeeded)
												? "The available source responses did not establish all requested information"
												: "No available source can establish the remaining information in this attempt",
								},
							];
					}
			} catch (error) {
				for (const state of states)
					if (state.fetching === 0) {
						state.attempted = state.version;
						state.issues = [{ kind: "read", message: message(error) }];
					}
			}
			this.host.changed();
		});
	}
	private drain(): void {
		for (const [key, work] of [...this.queued].sort(
			(left, right) => left[1].order - right[1].order,
		)) {
			if (this.closed || this.running >= this.maxConcurrent) break;
			if (this.busy.has(key)) continue;
			if (work.source)
				this.host.batch(() => {
					for (let index = work.states.length - 1; index >= 0; index--) {
						const state = work.states[index];
						if (
							!state ||
							(this.cycles.get(state)?.attempts.length ?? 0) <
								this.maxAcquisitionsPerRead
						)
							continue;
						work.states.splice(index, 1);
						state.fetching--;
						state.attempted = state.version;
						state.issues = [
							{
								kind: "incomplete",
								message: `This read reached its limit of ${this.maxAcquisitionsPerRead} source acquisitions; retry can continue with the remaining information`,
							},
						];
						this.host.changed();
					}
				});
			if (
				(work.source && work.states.length === 0) ||
				(work.states.length > 0 &&
					work.states.every(
						(state) => !state.active || !this.host.needs(state),
					))
			) {
				this.queued.delete(key);
				this.host.batch(() => {
					for (const state of work.states) state.fetching--;
					this.host.changed();
				});
				continue;
			}
			this.queued.delete(key);
			this.busy.set(key, work);
			this.host.batch(() => this.host.changed());
			if (work.source)
				for (const state of work.states)
					this.cycles.get(state)?.attempts.push(work.source);
			this.running++;
			const controller = new AbortController();
			this.controllers.add(controller);
			const context = this.host.context(controller.signal);
			const canDiscloseError = this.host.errorGuard(work.states, work.source);
			void Promise.resolve()
				.then(() => work.run(context))
				.then(
					(batch) => {
						if (batch) context.observe(batch);
						if (work.source) work.source.succeeded = true;
					},
					(error) => {
						const disclose = !controller.signal.aborted && canDiscloseError();
						work.fail?.(
							disclose
								? error
								: new Error("Read access changed during acquisition"),
						);
						if (disclose)
							for (const state of work.states)
								state.issues = [{ kind: "read", message: message(error) }];
					},
				)
				.finally(() => {
					this.controllers.delete(controller);
					this.busy.delete(key);
					this.running--;
					this.host.batch(() => {
						work.states.forEach((state) => {
							state.fetching--;
							if (work.source && state.descriptor.sample)
								state.attempted = Math.max(state.attempted, state.forced);
						});

						this.host.changed();
					});
					this.schedule();
					this.drain();
				});
		}
	}

	close(): void {
		this.closed = true;
		for (const controller of this.controllers) controller.abort();
		for (const work of this.queued.values())
			work.fail?.(new Error("Runtime closed"));
		this.queued.clear();
		this.controllers.clear();
	}
}
