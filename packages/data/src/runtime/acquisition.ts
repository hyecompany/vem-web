// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { AcquisitionError } from "../acquisition-error.js";
import { stableKey } from "../descriptors.js";
import {
	type MissingRequirement,
	requirementKey,
} from "../read-model/requirements.js";
import type { QueryPopulation } from "../read-model/types.js";
import type {
	AcquisitionRequest,
	EvidenceRef,
	ObservationResult,
	QueryDescriptor,
	QueryIssue,
	ResourceContext,
	ResourceDefinition,
} from "../types.js";
import { acquisitionPriority } from "./acquisition-priority.js";
import { type PlannedAcquisition, planAcquisitions } from "./planning.js";
import { acquisitionDemandKey } from "./planning-supersession.js";
import { currentFailures, failQuery } from "./query-issues.js";
import { executeSource } from "./source-execution.js";
import type { QueryState } from "./state.js";

interface Work {
	key: string;
	order: number;
	states: QueryState[];
	run(
		context: ResourceContext,
		dispatched?: () => void,
	): Promise<ObservationResult>;
	fail?(error: unknown): void;
	source?: PlannedAcquisition;
	controller?: AbortController;
	dispatched?: boolean;
}
interface AcquisitionHost {
	evidenceGeneration?(ref: EvidenceRef): number;
	population(request: AcquisitionRequest): QueryPopulation;
	matches(request: AcquisitionRequest, identity: unknown): boolean;
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
	private supersessions: {
		work: Work;
		replacements: Work[];
		demand: string;
		authority: string;
	}[] = [];
	private running = 0;
	private planned = false;
	private closed = false;
	private sequence = 0;
	constructor(
		private readonly host: AcquisitionHost,
		private readonly maxConcurrent: number | undefined,
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
	*work(): Iterable<{
		state: QueryState;
		requirements: readonly MissingRequirement[];
	}> {
		for (const work of [...this.queued.values(), ...this.busy.values()]) {
			if (!work.source) continue;
			for (const state of work.states) {
				if (!state.active) continue;
				const requirements = work.source.requirements?.get(state.key);
				if (requirements?.length) yield { state, requirements };
			}
		}
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
				if (state.issues.length) {
					const failures = currentFailures(
						state,
						this.host.requirements(state.descriptor),
					);
					if (failures.length !== state.issues.length) {
						state.failures = failures;
						state.issues = failures.map((failure) => failure.issue);
						this.host.changed();
					}
				}
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
		const cycleAdvanced = (state: QueryState) =>
			state.forced !== this.cycles.get(state)?.forced ||
			context.authorityFence !== this.cycles.get(state)?.authority ||
			generation(state) > (this.cycles.get(state)?.generation ?? -1);
		if (
			!all.some(
				(state) =>
					state.active &&
					this.host.needs(state) &&
					((state.fetching === 0 && state.attempted < state.version) ||
						cycleAdvanced(state)),
			)
		)
			return;
		const states = all.filter(
			(state) =>
				state.active &&
				this.host.needs(state) &&
				(state.attempted < state.version ||
					state.fetching > 0 ||
					cycleAdvanced(state)),
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
					if (work.source) {
						work.source.revalidates = source.revalidates;
						work.source.requirements = source.requirements;
					}
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
						run: (context, dispatched) =>
							executeSource(
								source,
								context,
								() =>
									source.states.some(
										(state) => state.active && this.host.needs(state),
									),
								dispatched,
							),
					});
				}
				this.supersessions = result.supersessions.flatMap((replacement) => {
					const work = this.busy.get(replacement.key);
					if (!work) return [];
					const replacements = replacement.replacements.flatMap((key) => {
						const source = this.busy.get(key) ?? this.queued.get(key);
						return source ? [source] : [];
					});
					return replacements.length === replacement.replacements.length
						? [
								{
									work,
									replacements,
									demand: replacement.demand,
									authority: context.authorityFence,
								},
							]
						: [];
				});
				for (const state of result.uncovered)
					if (state.fetching === 0) {
						state.attempted = state.version;
						const cycle = this.cycles.get(state);
						if (cycle) {
							cycle.finished = true;
							cycle.through = state.version;
						}
						if (this.host.needs(state)) {
							for (const failure of result.failures.get(state) ?? [])
								failQuery(
									state,
									failure.issue,
									failure.requirements,
									failure.retryable,
								);
							const attributed = new Set(
								(state.failures ?? []).flatMap((failure) =>
									failure.requirements.map(requirementKey),
								),
							);
							const remaining = this.host
								.requirements(state.descriptor)
								.filter(
									(requirement) => !attributed.has(requirementKey(requirement)),
								);
							if (remaining.length)
								failQuery(
									state,
									{
										kind: cycle?.attempts.some((attempt) => attempt.succeeded)
											? "incomplete"
											: "unsupported",
										message:
											(cycle?.attempts.length ?? 0) >=
											this.maxAcquisitionsPerRead
												? `This read reached its limit of ${this.maxAcquisitionsPerRead} source acquisitions; retry can continue with the remaining information`
												: cycle?.attempts.some((attempt) => attempt.succeeded)
													? "The available source responses did not establish all requested information"
													: "No available source can establish the remaining information in this attempt",
									},
									remaining,
								);
						}
					}
			} catch (error) {
				for (const state of states)
					if (state.fetching === 0) {
						state.attempted = state.version;
						failQuery(
							state,
							error instanceof AcquisitionError
								? error.issue
								: { kind: "read", message: message(error) },
							this.host.requirements(state.descriptor),
						);
					}
			}
			this.host.changed();
		});
	}
	private drain(): void {
		for (const [key, work] of [...this.queued].sort(
			(left, right) => left[1].order - right[1].order,
		)) {
			if (
				this.closed ||
				(this.maxConcurrent !== undefined && this.running >= this.maxConcurrent)
			)
				break;
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
						failQuery(
							state,
							{
								kind: "incomplete",
								message: `This read reached its limit of ${this.maxAcquisitionsPerRead} source acquisitions; retry can continue with the remaining information`,
							},
							this.host.requirements(state.descriptor),
						);
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
			work.controller = controller;
			const context = this.host.context(controller.signal);
			Object.defineProperty(context, "fetchPriority", {
				enumerable: true,
				get: () => acquisitionPriority(work.source),
			});
			const canDiscloseError = this.host.errorGuard(work.states, work.source);
			void Promise.resolve()
				.then(() => {
					return work.run(context, () => {
						work.dispatched = true;
						this.cancelSuperseded();
					});
				})
				.then(
					(batch) => {
						if (batch) context.observe(batch);
						if (work.source && !controller.signal.aborted)
							work.source.succeeded = true;
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
								failQuery(
									state,
									error instanceof AcquisitionError
										? error.issue
										: { kind: "read", message: message(error) },
									work.source?.requirements?.get(state.key) ??
										this.host.requirements(state.descriptor),
								);
					},
				)
				.finally(() => {
					if (!this.finish(work)) return;
					this.schedule();
					this.drain();
				});
		}
		this.cancelSuperseded();
	}

	private finish(work: Work, canceled = false): boolean {
		if (this.busy.get(work.key) !== work) return false;
		if (work.controller) this.controllers.delete(work.controller);
		this.busy.delete(work.key);
		this.supersessions = this.supersessions.filter(
			(proof) => proof.work !== work && !proof.replacements.includes(work),
		);
		this.running--;
		this.host.batch(() => {
			for (const state of work.states) {
				state.fetching--;
				if (canceled) {
					const cycle = this.cycles.get(state);
					if (cycle)
						cycle.attempts = cycle.attempts.filter(
							(attempt) =>
								attempt.key !== work.source?.key ||
								attempt.generation !== work.source.generation,
						);
				} else if (
					work.source &&
					state.descriptor.sample &&
					state.fetching === 0
				) {
					state.attempted = Math.max(state.attempted, state.forced);
				}
			}
			this.host.changed();
		});
		return true;
	}
	private cancelSuperseded(): void {
		let canceled = false;
		for (const proof of this.supersessions) {
			const { work } = proof;
			if (
				!work.source ||
				this.busy.get(work.key) !== work ||
				!proof.replacements.every(
					(replacement) =>
						replacement.dispatched &&
						this.busy.get(replacement.key) === replacement,
				)
			)
				continue;
			if (
				acquisitionDemandKey(this.host, work.source) !== proof.demand ||
				this.host.context(new AbortController().signal).authorityFence !==
					proof.authority
			)
				continue;
			work.controller?.abort();
			canceled = this.finish(work, true) || canceled;
		}
		if (canceled) {
			this.schedule();
			this.drain();
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
