<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Repository integration tests

These suites test built artifacts and complete browser journeys. Runtime behavior, public contracts, and executable example definitions belong to [the data package tests](../packages/data/tests/README.md).

| Location | Responsibility | Command |
| --- | --- | --- |
| `docs/*.test.mjs` | Static export, internal links, search coverage, and site accessibility | `npm run test:docs` |
| `docs/experiments/*.test.mjs` | Interactive learning tools against the built docs | `npm run test:docs` |
| `package/*.test.mjs` | Actual HTTP/event fixture and SharedWorker starter, including independent installed-package behavior | `npm run test:package` |
| `support/` | Browser launch configuration shared across suites | Imported helpers only |

Build the site with `npm run docs:build` before running documentation tests. The production site uses an empty base path; when testing a subpath, use the same `BASE_PATH` for the build and tests.

`test:package` builds and packs Vem Data, installs that tarball in an independent consumer, checks public imports and compiled examples, and runs the starter browser journey there. For focused work on the source starter, run `node --test tests/package/starter.test.mjs` after building Vem Data.

Add tests to the suite that owns the behavior. Documentation tests and the packed-consumer check use recursive globs, so nested `*.test.mjs` files are discovered on Windows and Unix. Give helper files ordinary names and keep them in the nearest `support/` directory; do not name them `*.test.mjs`. Share helpers across suites only when both actually need them. Package tests must not require the documentation static server or exported site.
