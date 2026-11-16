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

Source files carry SPDX tags for copyright and `Apache-2.0`. `REUSE.toml` provides the default license, with explicit exceptions for MIT notices, OFL fonts, and reserved Hye branding:

```text
SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
SPDX-License-Identifier: Apache-2.0
```

Vem UI components adapted from shadcn retain its MIT copyright and license notices. Attribute every Vem modification with a closed SPDX snippet naming its actual author and license. Include import rewrites and removed behavior in the review; snippets are attribution boundaries, not an automatic merge recipe. Independently authored components keep their own file notices.

Each adapted file has a short `Source:` comment linking to the real upstream file at the Git commit last reviewed for that implementation. A generated preset can name both its component template and style source. These links identify the review baseline; they do not claim that an older installed registry payload was generated at an unverified revision. Update the pinned URL when reviewing an upstream change, and explain any intentionally retained differences in the modification snippets.

`npm run check:ui-provenance` checks source links and snippet notices offline. `npm run check:ui-upstream` compares those actual files against upstream's current default branch and writes a local report. The scheduled workflow attempts a three-way merge from the pinned source to its current upstream revision. A clean merge that preserves local attribution opens a draft PR; conflicts, deleted sources, and generated-style changes open a review issue. It never merges or publishes. Complete diffs and candidate files are available as workflow artifacts. Closing a review records that candidate as reviewed, and repeated runs do not recreate it. New upstream content creates a new candidate; existing PR branches are never force-pushed or overwritten. Base UI is an npm dependency and uses the normal dependency-update workflow.

## Checks

From a clean install on Node.js 24 or newer:

```sh
npm ci
npm run docs:prepare
npm run check
npm run typecheck
npm test
npm run test:package
npm run test:docs-package
npm run docs:build
npm run test:docs
```

Browser checks default to Playwright Chromium. Install the engines with `npx playwright install chromium firefox webkit`. Set `VEM_BROWSER=firefox` or `VEM_BROWSER=webkit` to check another engine, or use installed Chrome with `VEM_BROWSER_CHANNEL=chrome`. CI checks all three engines.

`test:package` verifies all public imports and typed examples in an isolated packed consumer, then exercises its actual SharedWorker starter. It does not publish a package. `test:docs` checks static links, anchors, reference coverage, search, exports, and interactive reader journeys. The production domain uses an empty `BASE_PATH`. Set `BASE_PATH=/vem-web` for both build and checks only when validating deployment under a subpath.

## Documentation and examples

Edit `packages/docs/content/handbook`, add compiled snippets under `packages/data/examples`, and put API semantics in JSDoc on public declarations. `npm run docs:prepare` generates reference, navigation, content, and machine-readable exports. Never hand-edit `content/docs` or `.generated`.

Follow the [documentation contributor guide](packages/docs/content/handbook/data/reference/contributing.mdx) for diagrams, focused experiments, accessibility, and failure-path checks. Keep runtime behavior changes separate from documentation-only work; record discovered discrepancies explicitly.

## Where tests belong

Keep package behavior and compile-only contracts under `packages/data/tests` and `packages/ui/tests`, grouped by responsibility. Built documentation checks belong in `tests/docs`; the actual HTTP/SharedWorker starter journey belongs in `tests/package` and runs through `test:package` against an installed tarball. Shared browser setup is in `tests/support`, while each suite owns its own fixtures and helpers. See [the test layout](tests/README.md) for commands and placement rules.

## Releases and deployment

Release Please opens independent package release PRs from Conventional Commits on `main`. Review each proposed version, especially breaking changes, then merge the release PR to create its tag and invoke publication. Changed package paths determine the package; the commit scope alone does not. The release manifest records published versions, not unreleased candidates.

The publish workflow verifies the selected package and tag, checks the packed artifact, and skips versions already on npm. To retry a failed publication, run **Publish packages** with that package and its existing release tag. Configure npm trusted publishers for `hyecompany/vem-web` with the calling workflows `release-please.yml` and `publish.yml`; initial package registration may require npm account authorization.

Repository settings must allow GitHub Actions to create pull requests. PR checks created by the workflow token may require approval; review the generated changes before approving those runs. Automation never supplies a human DCO sign-off.

The Documentation workflow deploys `main` through GitHub Pages. Pages uses GitHub Actions as its source and `hyevem.com` as its custom domain, with HTTPS enabled. DNS and npm account settings are managed outside this repository. The site opens directly at `/docs/` and supports a static redirect fallback.
