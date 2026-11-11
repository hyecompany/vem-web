// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type {
	TransferDefinition,
	TransferExecution,
	TransferExecutor,
	TransferReceipt,
	TransferRecord,
} from "./transfer-types.js";

export type * from "./transfer-types.js";

export type Values = Record<string, unknown>;
export type Identity = unknown;
/** An independently admitted change feed for a precise scope; connection alone does not establish coverage. */
export interface ContinuityRef {
	channel: string;
	scope?: unknown;
}
/** Every required feed, or one independently sufficient feed, must remain continuous. */
export type LivenessRequirement =
	| ContinuityRef
	| { all: readonly ObservationLiveness[] }
	| { any: readonly ObservationLiveness[] };
/** Snapshots make no continuing guarantee; immutable values cannot change for the stated identity. */
export type ObservationLiveness =
	| "immutable"
	| "snapshot"
	| LivenessRequirement;
export type FieldLiveness = "immutable" | "live" | "snapshot";
/** Unknown is unestablished permission, not revocation. Denied is known loss; allowed supports disclosure only within its grant generation. */
export type AccessState = "allowed" | "denied" | "unknown";
/** Permission requirements compose independently granted scopes without confusing unknown authority with denial. */
export type AccessRequirement =
	| string
	| { all: readonly AccessRequirement[] }
	| { any: readonly AccessRequirement[] };
/** One permission basis captured at a particular generation and authority. A later regrant does not make a retired basis valid again. */
export interface GrantRef {
	scope: string;
	generation: number;
	contextId?: string;
	epoch?: string;
}
/** Captured permission evidence; every member of all or one member of any must remain valid. */
export type DisclosureProof =
	| GrantRef
	| { all: readonly DisclosureProof[] }
	| { any: readonly DisclosureProof[] };
/** Symbolic permission scopes or already captured proofs; source contexts resolve symbolic leaves after their batch's verified grants. */
export type DisclosureBasis =
	| string
	| GrantRef
	| { all: readonly DisclosureBasis[] }
	| { any: readonly DisclosureBasis[] };
/** Authority dependency retained independently of resource payloads so later withdrawal also reaches earlier evidence. */
export interface AccessBinding {
	key: string;
	scope: string;
	requires: AccessRequirement;
	contextId?: string;
}
export interface AccessDecision {
	scope: string;
	/** Verified dependencies of this acquired permission. Unknown prerequisites never imply revocation. */
	requires?: AccessRequirement;
	/** Omit when attaching a verified dependency without a new permission decision. */
	state?: AccessState;
	contextIndependent?: boolean;
}
/** Apply explicit authority evidence. retirePrevious retires the prior context when changing authority; ordinary network failure is not evidence to retire it. */
export interface AccessUpdate {
	contextId?: string;
	decisions: readonly AccessDecision[];
	retirePrevious?: boolean;
}
/** Current authority context and scope generations used to fence disclosure, restoration, and managed drafts. */
export interface AccessSnapshot {
	contextId: string;
	epoch?: string;
	revision: number;
	// Each value identifies the latest generation retired for that authority context.
	retiredContexts?: Readonly<Record<string, number>>;
	scopes: Readonly<
		Record<
			string,
			{
				state: AccessState;
				generation: number;
				contextIndependent?: boolean;
				requires?: AccessRequirement;
			}
		>
	>;
}

/** A side-effect-free request for selected information. Identity or collection scope, filter dependencies, and membership determine what acquisition is still needed. */
export interface QueryDescriptor<T extends object = Values, I = Identity> {
	kind: "query";
	resource: string;
	mode: "one" | "list";
	identity?: I;
	scope?: unknown;
	select: readonly (keyof T & string)[];
	where?: Readonly<Values>;
	orderBy?: readonly { field: string; direction?: "asc" | "desc" }[];
	sample?: { fields: readonly (keyof T & string)[]; intervalMs: number };
	readonly __values?: T;
}

/** A side-effect-free intended operation. Running it creates an action; constructing it neither admits nor submits work. */
export interface CommandDescriptor<
	Input = unknown,
	Outcome extends ActionOutcome = ActionOutcome,
> {
	kind: "command";
	resource: string;
	name: string;
	target?: unknown;
	input: Input;
	readonly __outcome?: Outcome;
}

/** A description of a managed editor. Preparing it acquires a writable baseline and its representation-specific concurrency token. */
export interface EditDescriptor<
	T extends object = Values,
	I = Identity,
	Outcome extends ActionOutcome = ActionOutcome,
> {
	kind: "edit";
	resource: string;
	name: string;
	target: I;
	readonly __values?: T;
	readonly __outcome?: Outcome;
}

/** Distinguishes an established resource reference from a pending creation proposal with only a requested identity. */
export type RowIdentity<I> =
	| { kind: "resource"; resource: I }
	| { kind: "proposal"; actionId: string; requested: Partial<I> };
/** Provenance and continuing currency of a selected field; snapshots do not imply a refresh policy. */
export interface FieldInfo {
	source: "observed" | "derived" | "proposed";
	liveness: FieldLiveness;
	actionIds: readonly string[];
	stale?: boolean;
}
/** A stable presentation row with selected values. Narrow complete or use hasFields before treating partial values as present; proposal identity is not a command target. */
export type QueryRow<T extends object = Values, I = Identity> = {
	key: string;
	identity: RowIdentity<I>;
	actionIds: readonly string[];
	fields: Readonly<Partial<Record<keyof T, FieldInfo>>>;
} & (
	| { complete: true; data: Readonly<T>; missing: readonly [] }
	| {
			complete: false;
			data: Readonly<Partial<T>>;
			missing: readonly (keyof T & string)[];
	  }
);
/** An acquisition, access, or unsupported-information explanation. Existing permitted rows may remain usable alongside issues. */
export interface QueryIssue {
	kind: "read" | "access" | "unsupported" | "incomplete";
	message: string;
	scope?: string;
}
/** An evidence-based read result. Established matches, unresolved candidates, confirmed coverage, and action proposals remain distinct; zero rows alone never proves emptiness. */
export interface QueryResult<T extends object = Values, I = Identity> {
	/** Established matches and visible proposals, including rows with missing display fields. */
	rows: readonly QueryRow<T, I>[];
	/** Candidates whose required filter or scope evidence is missing; do not present them as confirmed matches. */
	unresolved: readonly QueryRow<T, I>[];
	/** Coverage and count of confirmed matches, excluding proposal-only identities. */
	confirmed: {
		complete: boolean;
		knownCount: number;
		total: number | undefined;
	};
	activities: readonly ActionSnapshot[];
	/** Whether permitted evidence needed by this query is known to need revalidation; missing information alone is not stale. */
	stale: boolean;
	/** Whether running acquisition is checking this query's stale evidence; false while repair is stopped, failed, or only unrelated missing information is being acquired. */
	revalidating: boolean;
	/** Whether acquisition is outstanding; existing rows and unconfirmed candidates can remain visible. */
	fetching: boolean;
	/** Whether the current attempt has settled, even if information remains partial or failed. */
	settled: boolean;
	/** True only when the result is established as empty; do not infer this from rows.length. */
	empty: boolean;
	/** Established detail presence or absence; undefined means unestablished. */
	exists: boolean | undefined;
	issues: readonly QueryIssue[];
	revision: number;
}
/** A coherent snapshot and a subscription. Unsubscribing stops observation; it does not cancel accepted server work. */
export interface Watch<T> {
	getSnapshot(): T;
	subscribe(listener: () => void): () => void;
	dispose?(): void;
}
/** A subscribed read with explicit retry for unsuccessful acquisition. Dispose imperative handles when the consumer ends. */
export interface QueryHandle<T extends object = Values, I = Identity>
	extends Watch<QueryResult<T, I>> {
	retry(): Promise<QueryResult<T, I>>;
	dispose(): void;
}

export interface ResourceReference {
	resource: string;
	identity: Identity;
}
export interface RelationshipRef extends ResourceReference {
	relationship: string;
	target?: ResourceReference;
}
export type EvidenceRef = FactRef | RelationshipRef;
/** Evidence linking resources. Complete coverage and supporting permissions are tracked separately from endpoint fields and collection membership. */
export interface RelationshipObservation
	extends Omit<RelationshipRef, "target"> {
	targets: readonly ResourceReference[];
	/** Per-target independent disclosure bases, overriding the aggregate basis for that edge. */
	targetBasis?: readonly {
		target: ResourceReference;
		basis: readonly DisclosureBasis[];
	}[];
	removed?: readonly ResourceReference[];
	complete: boolean;
	basis?: readonly DisclosureBasis[];
	liveness?: ObservationLiveness;
	/** Supporting facts or relationships whose loss also withdraws the derived conclusion. */
	dependsOn?: readonly EvidenceRef[];
}
export interface KnownRelationship {
	targets: readonly ResourceReference[];
	complete: boolean;
	liveness: FieldLiveness;
	stale: boolean;
}
export interface MembershipRef {
	resource: string;
	scope?: unknown;
	where?: Readonly<Values>;
}
export interface KnownCollection extends MembershipRef, KnownMembership {}
export interface KnownMembership {
	identities: readonly Identity[];
	complete: boolean;
}
export interface FactRef {
	resource: string;
	identity: Identity;
	field: string;
}
/** Values about a resource, independent of endpoint shape and collection completeness. Bases justify disclosure; dependencies justify derived values. */
export interface FactObservation {
	resource: string;
	identity: Identity;
	values?: Readonly<Values>;
	// Omitted fields inside this representation boundary are removed; other representations survive.
	/** Omitted fields inside this representation boundary are removed; unrelated representations survive. */
	replace?: readonly string[];
	presence?: "present" | "absent";
	basis?: readonly DisclosureBasis[];
	/** Per-field independent disclosure bases, overriding the observation-wide basis. */
	fieldBasis?: Readonly<Record<string, readonly DisclosureBasis[]>>;
	/** Supporting facts or relationships whose loss also withdraws the derived conclusion. */
	dependsOn?: readonly EvidenceRef[];
	certifiedBasis?: readonly DisclosureBasis[];
	liveness?: ObservationLiveness;
	/** A field may have a different change feed or be immutable while its representation is a snapshot. */
	fieldLiveness?: Readonly<Record<string, ObservationLiveness>>;
}
/** Evidence of collection membership for the stated scope and filter. complete must be false for partial or paginated enumeration that has not established the whole set. */
export interface MembershipObservation {
	resource: string;
	scope?: unknown;
	where?: Readonly<Values>;
	identities: readonly Identity[];
	complete: boolean;
	basis?: readonly DisclosureBasis[];
	liveness?: ObservationLiveness;
}
/** Facts and their consequences applied through one publication boundary. Direct evidence is preferable to invalidating information that can already be updated. */
export interface ObservationBatch {
	facts?: readonly FactObservation[];
	relationships?: readonly RelationshipObservation[];
	memberships?: readonly MembershipObservation[];
	grants?: readonly AccessDecision[];
	invalidate?: readonly EvidenceRef[];
	invalidateMemberships?: readonly MembershipRef[];
}
// biome-ignore lint/suspicious/noConfusingVoidType: Adapters can publish through context.observe instead of returning a batch.
export type ObservationResult = ObservationBatch | void;
export interface KnownRecord {
	key: string;
	resource: string;
	identity: Identity;
	values: Readonly<Values>;
	presence: "present" | "absent" | "unknown";
	fields: Readonly<Record<string, FieldInfo>>;
}
/** An acquisition-fenced view of current knowledge and authority. Publish through this context so obsolete responses cannot revive withdrawn or superseded information. */
export interface ResourceContext {
	readonly signal: AbortSignal;
	readonly accessContext: string;
	readonly acquisitionFence: string;
	/** Captured authority generations, independent of ordinary knowledge changes. */
	readonly authorityFence: string;
	get(resource: string, identity: Identity): KnownRecord | undefined;
	/** Reuse the captured disclosure evidence for a confirmed field or relationship; throws when unavailable. */
	disclosure(ref: EvidenceRef): DisclosureProof;
	records(resource: string): readonly KnownRecord[];
	memberships(resource: string): readonly KnownCollection[];
	relationship(
		resource: string,
		identity: Identity,
		name: string,
	): KnownRelationship | undefined;
	membership(
		resource: string,
		scope?: unknown,
		where?: Readonly<Values>,
	): KnownMembership | undefined;
	observe(batch: ObservationBatch): void;
	grant(scope: string, state: AccessState): void;
	basis(scope: string): GrantRef;
	/** Capture an admission expression as a disclosure proof for this acquisition generation. */
	proof(requirement: AccessRequirement): DisclosureProof;
	access(scope: string): AccessState;
}
/** A backend read selected by Vem. Fixed sources receive every advertised field; field-selecting sources receive the missing projection. Returned observations may provide more. */
export interface AcquisitionRequest {
	resource: string;
	mode: "one" | "list";
	identity?: Identity;
	scope?: unknown;
	where?: Readonly<Values>;
	fields: readonly string[];
	relationships: readonly string[];
	sample?: QueryDescriptor["sample"];
	page?: { cursor?: unknown; limit: number };
}
/** One page of source observations. A continuation is followed by Vem; membership identities accumulate without claiming completeness before the last page. */
export interface AcquisitionPage {
	batch: ObservationBatch;
	next?: unknown;
}
/** Describes a backend read's capabilities, not a request plan. Only actual observations establish information or collection completeness. */
export interface AcquisitionSource {
	/** Stable source identifier, unique within its resource definition; consumers do not supply query cache keys. */
	key: string;
	mode: "one" | "list";
	fields: readonly string[];
	/** True for field-selecting backends. Fixed representations (the default) can supply every declared field to later consumers. */
	select?: boolean;
	relationships?: readonly string[];
	/** True when this list source can enumerate its collection. Partial responses must still report complete: false. */
	membership?: boolean;
	/** Relative positive acquisition cost, including expected continuation work. Vem balances cost against shared missing information. Defaults to 1. */
	cost?: number | ((request: AcquisitionRequest) => number);
	/** Maps an identity or consumer scope to the collection scope read by this source. Defaults to the query scope. */
	scope?(query: QueryDescriptor): unknown;
	/** Equality filters accepted by the backend; unsupported terms remain local predicates. */
	filters?: readonly string[];
	/** Request admission is separate from the disclosure bases carried by returned observations. Unknown permission permits an attempt by default. */
	access?:
		| AccessRequirement
		| ((
				request: AcquisitionRequest,
				context: ResourceContext,
		  ) => AccessRequirement);
	/** Unknown permission permits an attempt by default; a pure callback can wait for a separately discoverable authority prerequisite. */
	accessUnknown?:
		| "attempt"
		| "wait"
		| ((
				request: AcquisitionRequest,
				context: ResourceContext,
		  ) => "attempt" | "wait");
	/** Bounded continuation controlled by Vem. Sources return AcquisitionPage instead of fetching subsequent pages themselves. */
	pagination?: { pageSize: number; maxPages?: number };
	/** Pure representation-support check. Use access for authorization; this check must not acquire information or mutate authority. */
	available?(request: AcquisitionRequest, context: ResourceContext): boolean;
	run(
		request: AcquisitionRequest,
		context: ResourceContext,
	): Promise<ObservationResult | AcquisitionPage>;
}
/** Pure identity, scope, filter, and access rules shared by owner and tab. No transport or mutable owner state belongs here. */
export interface ResourceReadDefinition {
	name: string;
	key?(identity: Identity): string;
	/** Additional predicate or mutable-scope fields required to decide matches; exclude display-only fields. */
	queryDependencies?(query: QueryDescriptor): readonly string[];
	inScope?(
		identity: Identity,
		scope: unknown,
		values: Readonly<Values>,
	): boolean | "unknown";
	matches?(
		values: Readonly<Values>,
		where: Readonly<Values>,
		scope: unknown,
		identity: Identity,
	): boolean | "unknown";
	/** A global read requirement, evaluated consistently in the owner and tab. */
	access?: AccessRequirement | ((query: QueryDescriptor) => AccessRequirement);
	/** Per-field disclosure and read admission. A denied field does not prevent acquiring independently readable fields. */
	fieldAccess?: Readonly<
		Record<
			string,
			| AccessRequirement
			| ((identity: Identity) => AccessRequirement | undefined)
		>
	>;
}
/** Backend-specific evidence acquisition, extraction, derivation, commands, edits, and persistence allowances. Features depend on a resource contract rather than this owner definition. */
export interface ResourceDefinition extends ResourceReadDefinition {
	/** Information required before acquiring missing data; cached satisfied reads do not reacquire these prerequisites. */
	readPrerequisites?(
		query: QueryDescriptor,
		context: ResourceContext,
	): readonly QueryDescriptor[];
	/** Prerequisites that can establish detail presence, as an alternative to a direct source. */
	presenceDependencies?(
		identity: Identity,
		context: ResourceContext,
	): readonly (QueryDescriptor | RelationshipRef)[];
	/** Prerequisites that can establish collection membership, as an alternative to enumerating this resource directly. */
	membershipDependencies?(
		query: QueryDescriptor,
		context: ResourceContext,
	): readonly (QueryDescriptor | RelationshipRef)[];
	/** Backend capabilities from which Vem selects and shares acquisition automatically. */
	sources?: readonly AcquisitionSource[];
	/** Pure prerequisites for derived fields. Reevaluate related queries as identity or relationship information arrives; derive publishes the resulting value. */
	fieldDependencies?: Readonly<
		Record<
			string,
			(
				identity: Identity,
				context: ResourceContext,
			) => readonly (QueryDescriptor | RelationshipRef)[]
		>
	>;
	event?(event: unknown, context: ResourceContext): ObservationResult;
	derive?(
		changed: readonly EvidenceRef[],
		context: ResourceContext,
	): ObservationResult;
	commands?: Readonly<Record<string, CommandDefinition>>;
	edits?: Readonly<Record<string, EditDefinition>>;
	persistRelationship?(name: string, identity: Identity): boolean;
	/** Return true only for fields the domain explicitly permits storing. */
	persist?(field: string, value: unknown, identity: Identity): boolean;
}

/** Evidence-supported operation outcome. Partial means some work is established; unknown means the result cannot be determined, not that nothing happened. */
export type ActionOutcome<Success = unknown, PartialResult = unknown> =
	| { kind: "succeeded"; value?: Success }
	| { kind: "partial"; value: PartialResult; message?: string }
	| {
			kind: "failed";
			error: { code?: string; message: string };
			submitted?: boolean;
	  }
	| { kind: "unknown"; message: string };
/** The command-specific outcomes plus framework failure and uncertainty; consumers must handle those even for a narrowly typed success contract. */
export type CommandResult<O extends ActionOutcome> =
	| O
	| Extract<ActionOutcome, { kind: "failed" | "unknown" }>;
/** Execution lifecycle state. A settled unknown outcome remains uncertain and is not automatically safe to retry. */
export type ActionPhase =
	| "admitting"
	| "preparing"
	| "running"
	| "recovering"
	| "settled";
/** Shared progress and outcome for one execution. Recovery availability describes journal durability, not whether the backend operation succeeded. */
export interface ActionSnapshot<Outcome extends ActionOutcome = ActionOutcome> {
	id: string;
	resource: string;
	name: string;
	target?: unknown;
	references?: readonly { resource: string; identity: unknown }[];
	phase: ActionPhase;
	progress?: { completed?: number; total?: number; message?: string };
	outcome?: Outcome;
	origin?: string;
	contextId: string;
	/** Whether action recovery metadata is pending, saved, or unavailable. */
	recovery: "pending" | "saved" | "unavailable";
	/** Present for transfers; browser ownership is reported only after confirmed handoff. */
	execution?: TransferExecution;
	revision: number;
	controls: { canCancel: boolean; canRetry: boolean };
}
/** Immediate handle returned by run. Its result promise settles with the outcome; cancel, retry, and stopping observation have separate meanings. */
export interface ActionHandle<Outcome extends ActionOutcome = ActionOutcome>
	extends Watch<ActionSnapshot<Outcome>> {
	id: string;
	result: Promise<Outcome>;
	cancel(): Promise<void>;
	retry(options?: { id?: string; origin?: string }): ActionHandle<Outcome>;
}
/** Whether an attempt can be admitted now. Unknown authorization differs from denial; available is not a server-side success guarantee. */
export interface Availability {
	state: "available" | "denied" | "unknown" | "unsupported" | "blocked";
	reason?: string;
	/** Transfer lifetime available before a browser has accepted the action. */
	execution?: TransferExecution;
}
/** Temporary action presentation above confirmed facts. Removing an update proposal reveals the latest confirmed values, not an old rollback snapshot. */
export interface ActionProjection {
	resource: string;
	identity?: Identity;
	requested?: Values;
	values: Readonly<Values>;
	kind: "update" | "create" | "delete";
	basis?: readonly DisclosureBasis[];
	retainOnFailure?: boolean;
}
/** Execution context for progress, submitted state, identity binding, and recoverable checkpoints. A checkpoint does not prove backend acceptance. */
export interface ActionContext extends ResourceContext {
	readonly actionId: string;
	submitted(): void;
	bind(resource: string, identity: Identity): void;
	progress(progress: NonNullable<ActionSnapshot["progress"]>): void;
	/** Save recoverable operation evidence; storage failure is observable and cannot promise recovery. */
	checkpoint(metadata: unknown): Promise<void>;
}
/** Domain admission, proposals, execution, and optional recovery. Report command-specific outcomes honestly and never blindly resubmit from recover. */
/** @inline */
interface CommandDefinitionBase {
	/** Admission expression, reevaluated immediately before execution. */
	access?:
		| AccessRequirement
		| ((command: CommandDescriptor) => AccessRequirement);
	/** Permission proof governing action details independently of execution. */
	disclosure:
		| DisclosureBasis
		| ((
				command: CommandDescriptor,
				context: ResourceContext,
		  ) => DisclosureBasis);
	execution?: "mutation" | "control";
	availability?(
		command: CommandDescriptor,
		context: ResourceContext,
	): Availability;
	project?(
		command: CommandDescriptor,
		context: ResourceContext,
	): readonly ActionProjection[];
	recovery?(command: CommandDescriptor): unknown;
	projectRecovery?(
		metadata: unknown,
		context: ResourceContext,
	): readonly ActionProjection[];
	// Existing work can have different cancellation permission from new-command admission.
	cancelAvailability?(
		metadata: unknown,
		context: ResourceContext,
	): Availability;
	/** Override the conservative default only when domain evidence makes a new attempt safe. */
	canRetry?(
		outcome: ActionOutcome,
		command: CommandDescriptor,
		context: ResourceContext,
	): boolean;
}
/** Choose custom execution or a native transfer; both use the same command and action contract. */
export type CommandDefinition = CommandDefinitionBase &
	(
		| {
				transfer?: never;
				run(
					command: CommandDescriptor,
					context: ActionContext,
				): Promise<ActionOutcome>;
				/** Investigate saved evidence without replaying the command. */
				recover?(
					metadata: unknown,
					context: ActionContext,
				): Promise<ActionOutcome>;
				cancel?(metadata: unknown, context: ActionContext): Promise<void>;
		  }
		| {
				transfer: TransferDefinition;
				execution?: "mutation";
				run?: never;
				recover?: never;
				cancel?: never;
		  }
	);
/** A protected writable baseline paired with its concurrency token and supporting grants. Do not reuse across invalid authority or owner generations. */
export interface PreparedEdit<
	T extends object = Values,
	Outcome extends ActionOutcome = ActionOutcome,
> {
	ownerEpoch?: string;
	descriptor: EditDescriptor<T, Identity, Outcome>;
	values: T;
	etag: string | null;
	baseline: unknown;
	/** Captured evidence protecting each baseline and draft value. */
	fieldDisclosure: Readonly<Record<keyof T, DisclosureProof>>;
	writeAccess: AccessRequirement;
	contextId: string;
	accessGeneration: number;
}
/** A writable representation before the owner captures its authority. Inherit disclosure from context.disclosure when mapping confirmed evidence. */
export interface EditBaseline {
	descriptor: EditDescriptor;
	values: Values;
	etag: string | null;
	baseline: unknown;
	/** Common disclosure evidence for writable values; fieldDisclosure overrides individual fields. */
	disclosure: DisclosureBasis;
	fieldDisclosure?: Readonly<Record<string, DisclosureBasis>>;
	writeAccess: AccessRequirement;
}
/** Prepares a writable representation and maps a managed draft to its conditional-save command. Layout and field validation remain application responsibilities. */
export interface EditDefinition {
	/** Required confirmed information acquired through shared query planning before prepare maps the writable baseline. */
	readPrerequisites?(
		descriptor: EditDescriptor,
		context: ResourceContext,
	): readonly QueryDescriptor[];
	prepare(
		descriptor: EditDescriptor,
		context: ResourceContext,
	): Promise<EditBaseline>;
	command(prepared: PreparedEdit, values: Readonly<Values>): CommandDescriptor;
}

/** Owner-captured continuity evidence; saved feed generations never establish continuity in a new owner. */
export type ContinuityProof =
	| "immutable"
	| "snapshot"
	| (ContinuityRef & { generation: number; epoch: string; live: boolean })
	| { all: readonly ContinuityProof[] }
	| { any: readonly ContinuityProof[] };
/** One independent observation's permission, truth dependencies, and continuing currency stay paired. */
export interface EvidenceSupport {
	bases: readonly DisclosureProof[];
	dependencies: readonly string[];
	disclosureDependencies?: readonly (readonly DisclosureProof[])[];
	independentDisclosure?: boolean;
	liveness: ContinuityProof;
	stale?: boolean;
}
export interface MembershipSupport extends EvidenceSupport {
	complete: boolean;
}
export interface PersistedFact {
	kind?: "field" | "relationship";
	relationshipTarget?: ResourceReference;
	contextId?: string;
	deleted?: boolean;
	key: string;
	resource: string;
	identity: Identity;
	field: string;
	value: unknown;
	bases: readonly DisclosureProof[];
	dependencies: readonly string[];
	disclosureDependencies?: readonly (readonly DisclosureProof[])[];
	independentDisclosure?: boolean;
	liveness: FieldLiveness;
	supports: readonly EvidenceSupport[];
	source: "observed" | "derived";
	revision: number;
}
export interface PersistedMembership extends MembershipObservation {
	deleted?: boolean;
	contextId?: string;
	key: string;
	bases: readonly DisclosureProof[];
	revision: number;
	supports: readonly MembershipSupport[];
	/** The enumeration was complete when observed, even if its current evidence has since become stale. */
	observedComplete: boolean;
	currencyRevision?: number;
	stale?: boolean;
}
/** Recovery evidence for an action that may have been submitted. A missing or incomplete journal is not proof that replay is safe. */
export interface ActionJournal {
	id: string;
	command: CommandDescriptor;
	snapshot: ActionSnapshot;
	metadata?: unknown;
	bases: readonly DisclosureProof[];
	possibleSubmission: boolean;
	transfer?: TransferRecord;
	bindings?: readonly { resource: string; identity: Identity }[];
}
/** Eligible saved evidence plus revocation records and unfinished action journals. Loading does not by itself authorize protected disclosure. */
export interface PersistenceSnapshot {
	accessBindings?: readonly AccessBinding[];
	facts: readonly PersistedFact[];
	memberships: readonly PersistedMembership[];
	actions: readonly ActionJournal[];
	revoked: Readonly<Record<string, number>>;
}
/** Storage boundary for facts, membership, journals, and durable revocation records. Live withdrawal must not wait for payload cleanup. */
export interface PersistenceAdapter {
	/** Persist authority bindings before later payload writes; load them before admitting protected restoration. */
	writeAccessBindings(bindings: readonly AccessBinding[]): Promise<void>;
	load(): Promise<PersistenceSnapshot>;
	loadPages?(pageSize: number): AsyncIterable<PersistenceSnapshot>;
	/** Store revision-ordered evidence. Deleted rows carry only ordering metadata and must supersede older payloads even without disclosure bases. */
	writeFacts(
		facts: readonly PersistedFact[],
		memberships: readonly PersistedMembership[],
	): Promise<void>;
	writeAction(action: ActionJournal): Promise<void>;
	/** Read only permitted handoff evidence for an existing action. */
	readTransfer?(id: string): Promise<TransferRecord | undefined>;
	/** Atomically claim prepared work; false never authorizes duplicate submission. */
	claimTransfer?(id: string): Promise<boolean>;
	/** Attach bounded evidence without recreating a missing or revoked action. */
	recordTransfer?(
		id: string,
		update: Pick<TransferRecord, "state"> & { receipt?: TransferReceipt },
	): Promise<boolean>;
	revoke(scopes: readonly GrantRef[]): Promise<void>;
	clear(): Promise<void>;
	close(): void;
}
/** Owner configuration with explicit concurrency, retention, hydration, recovery, access, and error reporting. Persistence is optional. */
export interface RuntimeOptions {
	resources: readonly ResourceDefinition[];
	/** Optional browser-managed transfer executor; unsupported handoffs use owner-bound fetch. */
	transfers?: TransferExecutor;
	/** Fetch implementation for owner-bound transfers; defaults to global fetch. */
	transferFetch?: typeof fetch;
	persistence?: PersistenceAdapter;
	/** Maximum concurrent acquisitions; defaults to 4. */
	maxConcurrent?: number;
	/** Bounds source dispatches for one finite read attempt. A partial result explains exhaustion; retry starts another attempt. Defaults to 4096. */
	maxAcquisitionsPerRead?: number;
	/** Maximum concurrent command executions; defaults to 4. */
	maxConcurrentActions?: number;
	maxPendingActions?: number;
	maxUnresolvedActions?: number;
	/** Maximum retained inactive queries; defaults to 100. */
	maxInactiveQueries?: number;
	/** Maximum retained inactive records; defaults to 10000. */
	maxInactiveRecords?: number;
	hydrationPageSize?: number;
	/** Maximum retained settled actions; defaults to 200. */
	maxSettledActions?: number;
	checkpointTimeoutMs?: number;
	contextId?: string;
	access?: readonly AccessDecision[];
	/** Receives owner errors such as persistence failures; report them without claiming durable success. */
	onError?(error: unknown): void;
}
/** The shared consumer contract for React and imperative use. Reads settle with available evidence; run immediately returns an action handle. */
export interface DataClient {
	watch<T extends object, I>(query: QueryDescriptor<T, I>): QueryHandle<T, I>;
	read<T extends object, I>(
		query: QueryDescriptor<T, I>,
		options?: { signal?: AbortSignal },
	): Promise<QueryResult<T, I>>;
	run<O extends ActionOutcome>(
		command: CommandDescriptor<unknown, O>,
		options?: { id?: string; origin?: string },
	): ActionHandle<O>;
	action(id: string): Watch<ActionSnapshot | undefined>;
	listActivities(): readonly ActionSnapshot[];
	subscribeActivities(listener: () => void): () => void;
	availability(command: CommandDescriptor): Availability;
	watchAvailability(command: CommandDescriptor): Watch<Availability>;
	subscribe(listener: () => void): () => void;
	prepareEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		descriptor: EditDescriptor<T, Identity, O>,
	): Promise<PreparedEdit<T, O>>;
	saveEdit<T extends object, O extends ActionOutcome = ActionOutcome>(
		prepared: PreparedEdit<T, O>,
		values: T,
		options?: { id?: string; origin?: string },
	): ActionHandle<CommandResult<O>>;
	access(scope: string): AccessState;
	accessSnapshot(): AccessSnapshot;
	revoke(scope: string): void;
	flush?(): Promise<void>;
	close(): void;
}
