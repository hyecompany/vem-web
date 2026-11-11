<!-- SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Vem Data tests

Put a test beside the behavior it protects. These directories describe stable responsibilities, not a copy of the implementation's module tree. Keep related edge cases in an existing suite; create another file when it covers a distinct behavior.

| Directory | What belongs here |
| --- | --- |
| `contracts/` | Public resource descriptions and the feature testing API |
| `types/` | Compile-only API inference and rejected-input assertions |
| `queries/` | Consumer results, projection, subscriptions, retry and revalidation |
| `knowledge/` | Observations, membership, relationships, derivation and continuity |
| `planning/` | Source selection, scheduling, filters, prerequisites and acquisition limits |
| `access/` | Permissions, disclosure proofs and revocation across acquisitions |
| `actions/` | Command execution, proposals and action outcomes |
| `editing/` | Drafts, writable baselines, conflicts and edit admission |
| `host/` | Tab/owner communication and local browser projection |
| `persistence/` | Durable state, hydration, restoration and action recovery |
| `devtools/` | Development scenarios and their lifetimes |
| `examples/` | Behavior of the compiled examples used by documentation |
| `support/` | Small fixtures used by several package suites |

A cross-cutting case has one home: choose the contract whose failure the test detects. Permission withdrawal during acquisition belongs in `access/`; selecting a cheaper permitted source belongs in `planning/`. Avoid duplicating the same scenario across folders.

## Run and extend

From `packages/data`:

```sh
npm test
npm run typecheck
npx tsx --tsconfig tsconfig.test.json --test "tests/planning/**/*.test.ts"
```

Runtime suites use `*.test.ts`. The quoted recursive pattern lets Node discover new nested suites on Windows and Unix without editing a file list. Type-only fixtures use `*.types.ts` and are checked by `tsconfig.test.json`; they are never executed as tests. Keep `@ts-expect-error` assertions in those fixtures when the assertion is purely a compile-time contract.

Keep a helper inside its suite until multiple suites need it. Shared helpers go in the nearest `support/` directory and do not use test-file suffixes. Do not add a runtime `src` export merely to make a test import easier.

Built documentation journeys and independently installed package checks live in the repository's [integration tests](../../../tests/README.md). They exercise artifact boundaries that the package behavior suites do not.

## Publication profiling

Run either benchmark from the repository root; optional row counts follow the command, for example `100 1000 5000`.

```sh
node --import tsx scripts/benchmarks/data-publication.mjs 100 1000 5000
node --import tsx scripts/benchmarks/publication-pipeline.mjs 100 1000 5000
```

The first benchmark isolates owner observation with no active owner queries and tab query projection with different counts of active and retained views. Keep it as a stable microbenchmark; it excludes message preparation, cloning, replica application, and rendering.

The pipeline benchmark adds real owner query subscriptions and three simulated tabs, retaining the same 12 descriptions per tab with 12, 6, and 1 active. The owner deduplicates these into 12 distinct active queries. It measures owner observation separately from publication preparation, structured cloning, replica application, and tab projection with subscribers reading their results. It updates a selected field, moves a row between filters, and changes a field absent from some selections. Assertions check the resulting rows and filter membership outside the timed sections. Notification counts show whether unrelated consumers were disturbed.

The pipeline's `summedCpu` adds synchronous work across those simulated contexts. It is **not browser interaction latency**: actual Worker scheduling, `postMessage`, network, React, and DOM work are not exercised. Profile the browser separately for those costs. Both scripts report their hardware, sample counts, medians, and p95 values; keep hardware-dependent timing thresholds out of behavior tests. To compare against another installed copy without changing the benchmark, set `VEM_BENCH_SOURCE_ROOT` to that copy's `src` directory for the pipeline command.
