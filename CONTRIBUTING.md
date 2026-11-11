<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contributing

## Commit messages

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). `commitlint.config.ts` extends `@commitlint/config-conventional`. Use `type(scope): description`. Mark a breaking change with `!`.

## Developer Certificate of Origin

Every commit includes a [Developer Certificate of Origin 1.1](https://developercertificate.org/) sign-off:

```text
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds the line. The name and email identify the contributor.

## License headers

Source files carry SPDX tags for copyright and `Apache-2.0`. `REUSE.toml` provides the default license, with explicit exceptions for MIT UI components, OFL fonts, and reserved Hye branding:

```text
SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
SPDX-License-Identifier: Apache-2.0
```

## Checks

From a clean install on Node.js 24 or newer:

```sh
npm ci
npm run docs:prepare
npm run check
npm run typecheck
npm test
npm run test:package
npm run docs:build
npm run test:docs
```

Browser checks use Playwright Chromium. Install it with `npx playwright install chromium`, or use installed Chrome with `VEM_BROWSER_CHANNEL=chrome`. CI installs its required browser explicitly.

`test:package` verifies all public imports and typed examples in an isolated packed consumer, then exercises its actual SharedWorker starter. It does not publish a package. `test:docs` checks static links, anchors, reference coverage, search, exports, and interactive reader journeys. The production domain uses an empty `BASE_PATH`. Set `BASE_PATH=/vem-web` for both build and checks only when validating deployment under a subpath.

## Documentation and examples

Edit `packages/docs/content/handbook`, add compiled snippets under `packages/data/examples`, and put API semantics in JSDoc on public declarations. `npm run docs:prepare` generates reference, navigation, content, and machine-readable exports. Never hand-edit `content/docs` or `.generated`.

Follow the [documentation contributor guide](packages/docs/content/handbook/data/reference/contributing.mdx) for diagrams, focused experiments, accessibility, and failure-path checks. Keep runtime behavior changes separate from documentation-only work; record discovered discrepancies explicitly.

## Where tests belong

Keep package behavior and compile-only contracts under `packages/data/tests`, grouped by responsibility. Built documentation checks belong in `tests/docs`; the actual HTTP/SharedWorker starter journey belongs in `tests/package` and runs through `test:package` against an installed tarball. Shared browser setup is in `tests/support`, while each suite owns its own fixtures and helpers. See [the test layout](tests/README.md) for commands and placement rules.
