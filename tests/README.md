<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Repository integration tests

These suites test built artifacts and complete browser journeys. Runtime behavior and public contracts belong to [the data package tests](../packages/data/tests/README.md) and `packages/ui/tests`.

| Location | Responsibility | Command |
| --- | --- | --- |
| `docs/*.test.mjs` | Static export, internal links, search coverage, and site accessibility | `npm run docs:validate` |
| `docs/experiments/*.test.mjs` | Interactive learning tools against the built docs | `npm run docs:validate` |
| `package/*.test.mjs` | Actual HTTP/event fixture and SharedWorker starter, including independent installed-package behavior | `npm run test:package` |
| `package/ui/*.test.mjs` | Independent packed UI consumer, server rendering, hydration, portable styles, and interactions | `npm run test:ui-package` |
| `github/*.test.mjs` | Release package isolation and workflow inputs | `npm run test:workflows` |
| `support/` | Browser launch configuration shared across suites | Imported helpers only |

`npm test` runs the Node and React suites without documentation generation or browser launches. `npm run test:affected` selects suites from changed paths; `npm run test:all` runs the complete release checks with shared preparation. Use `npm run docs:validate` to build and check the site together, or `npm run test:docs` against an existing build. The production site uses an empty base path; when testing a subpath, use the same `BASE_PATH` for the build and tests.

`test:package` checks both published-package artifacts. `test:data-package` builds and packs Vem Data, installs that tarball in an independent consumer, checks public imports and compiled examples, and runs the starter browser journey there. For focused work on the source starter, run `node --test tests/package/starter.test.mjs` after building Vem Data.

Add tests to the suite that owns the behavior. Documentation tests and the packed-consumer check use recursive globs, so nested `*.test.mjs` files are discovered on Windows and Unix. Give helper files ordinary names and keep them in the nearest `support/` directory; do not name them `*.test.mjs`. Share helpers across suites only when both actually need them. Package tests must not require the documentation static server or exported site.

UI maintenance checks live in `tests/ui-maintenance` and validate pinned upstream source links, attribution snippets, and update deduplication. `npm run test:docs-package` builds and exercises a packed Next.js consumer, including server rendering and client hydration. Optional UI/Data binding tests live in `packages/ui/tests/data`; core controls have no Data requirement.

## Focused React tests

Use `npm run test:react` for React contracts and `npm run test:react:watch` while editing them. Pass a file or name filter after `--`, for example `npm run test:react -- provider`.

Place `*.test.tsx` files in `packages/<package>/tests/react`, alongside that package's other behavior tests. Vitest uses jsdom and public package imports resolved to source, so these tests need no package build. React Testing Library cleans up each render; tests close clients and other resources they create. Assertions should describe visible state and public behavior rather than component internals.

Use this layer for provider lifetime, rendered states, and callback wiring. Keep layout, scrolling, browser focus, worker ownership, persistence, and cross-tab behavior in Playwright. The DOM environment does not establish those browser guarantees. Pure runtime tests continue using Node's runner, and independent packed consumers still verify the shipped exports.

`npm test`, full validation, and CI include React tests. React-only edits selected by `test:affected` run this suite and both packages' type checks; package or shared infrastructure changes retain full validation.
