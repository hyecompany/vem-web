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

Source files carry SPDX copyright and license headers. Use `REUSE.toml` for files that cannot carry comments and for generated files; there is no repository-wide fallback attribution. Independently authored code uses `Apache-2.0`:

```text
SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
SPDX-License-Identifier: Apache-2.0
```

Keep `LICENSES/` texts unmodified: obtain them with `reuse download`, leaving copyright placeholders intact. Keep actual copyright notices in source headers or `REUSE.toml`. Upstream license copies shipped with the site or npm packages retain their original notices in separate `LICENSE-*` files. `node scripts/check-license-texts.mjs` compares the standard templates with fresh REUSE downloads.

Vem UI components adapted from shadcn retain its MIT copyright and license notices. Attribute every Vem modification with a closed SPDX snippet naming its actual author and license. Include import rewrites and removed behavior in the review; snippets are attribution boundaries, not an automatic merge recipe. Independently authored components keep their own file notices.

Each adapted file has a short `Source:` comment linking to the real upstream file at the Git commit last reviewed for that implementation. A generated preset can name both its component template and style source. These links identify the review baseline; they do not claim that an older installed registry payload was generated at an unverified revision. Update the pinned URL when reviewing an upstream change, and explain any intentionally retained differences in the modification snippets.

`npm run check:ui-provenance` checks source links and snippet notices offline. `npm run check:ui-upstream` compares those actual files against upstream's current default branch and writes a local report. The scheduled workflow attempts a three-way merge from the pinned source to its current upstream revision. A clean merge that preserves local attribution opens a draft PR; conflicts, deleted sources, and generated-style changes open a review issue. It never merges or publishes. Complete diffs and candidate files are available as workflow artifacts. Closing a review records that candidate as reviewed, and repeated runs do not recreate it. New upstream content creates a new candidate; existing PR branches are never force-pushed or overwritten. Base UI is an npm dependency and uses the normal dependency-update workflow.

## Checks

Use Node.js 24.15 or newer in the 24 LTS line. After `npm ci`, choose the checks for the work:

| Command | Coverage |
| --- | --- |
| `npm test` | Runtime, React contracts, server-rendering, package-boundary, workflow, and maintenance tests; no browsers or docs build |
| `npm run test:react` | Focused React contracts without building packages |
| `npm run test:react:watch` | Focused React contracts, rerun as their imports change |
| `npm run test:affected` | Checks selected from changes against `origin/main`, including staged, unstaged, and untracked files |
| `npm run typecheck` | Package examples, type contracts, and documentation |
| `npm run test:browser` | UI interactions in Chromium, or the engine selected by `VEM_BROWSER` |
| `npm run docs:validate` | Generate, type-check, build, and test documentation |
| `npm run test:package` | Independent installed Data and UI consumers |
| `npm run test:all` | Complete validation, including all three browser engines and the packed Next.js consumer |

Install browser engines once with `npx playwright install chromium firefox webkit`. For the complete release check, run `npm run test:all`; builds, reference generation, and packing are shared within that invocation. Independent validation tasks run two at a time; prerequisites run once, and documentation type generation finishes before its production build. Each packed consumer still installs into its own empty directory. Only npm's download cache is reused.

`test:affected` prints its selection and reasons. To compare with another Git base, use `npm run test:affected -- --base <ref>`. It selects whole suites, not individual tests: documentation-only work runs documentation checks; shared package, configuration, or unknown inputs run everything. A missing comparison base also runs everything. PRs use this selection; main and release validation always use `test:all`.

Set `VEM_BROWSER=firefox` or `VEM_BROWSER=webkit` to run a focused browser check in another engine, or use installed Chrome with `VEM_BROWSER_CHANNEL=chrome`. UI browser suites reuse the browser process and server while isolating each test in a new browser context.

`test:package` verifies public imports and typed examples in independent packed consumers, then exercises the actual SharedWorker starter and UI. It does not publish. `test:docs` runs checks against an already built site; prefer `docs:validate` when editing documentation. The production domain uses an empty `BASE_PATH`; use `BASE_PATH=/vem-web` for both build and checks when validating a subpath.

## Documentation and examples

Edit package guides in `packages/data/docs` or `packages/ui/docs`, and framework pages in `docs/content/handbook`, add compiled snippets under `packages/data/examples`, and put API semantics in JSDoc on public declarations. `npm run docs:prepare` generates navigation, content, and machine-readable exports. Never hand-edit `content/docs` or `.generated`.

Follow the [documentation contributor guide](packages/data/docs/reference/contributing.mdx) for diagrams, focused experiments, accessibility, and failure-path checks. Keep runtime behavior changes separate from documentation-only work; record discovered discrepancies explicitly.

## Where tests belong

Keep package behavior and compile-only contracts under `packages/data/tests` and `packages/ui/tests`, grouped by responsibility. Built documentation checks belong in `tests/docs`; the actual HTTP/SharedWorker starter journey belongs in `tests/package` and runs through `test:package` against an installed tarball. Shared browser setup is in `tests/support`, while each suite owns its own fixtures and helpers. See [the test layout](tests/README.md) for commands and placement rules.

## Releases and deployment

Release Please opens independent package release PRs from Conventional Commits on `main`. Review each proposed version, especially breaking changes, then merge the release PR to create its tag and stage the package. Changed package paths determine the package; the commit scope alone does not. The release manifest records tagged versions; npm availability is verified separately.

The **Stage packages** workflow validates the release tag and uploads the package for npm approval. Follow the approval link in its run summary and approve the version with 2FA. Then run **Documentation** on `main` with **deploy** checked; the site changes only when both packages match their published releases.

To recover a failed staging run, select the package and existing release tag in **Stage packages**. A version already staged must be approved or rejected on npm before uploading it again.

Configure staging-only npm trusted publishers for `hyecompany/vem-web`: `release-please.yml` for automatic staging and `publish.yml` for manual recovery. Leave direct publishing disabled. GitHub release tags are created before staging; they do not establish npm availability.

Repository settings must allow GitHub Actions to create pull requests. PR checks created by the workflow token may require approval; review the generated changes before approving those runs. Automation never supplies a human DCO sign-off.

GitHub Pages serves the verified documentation release. Pages uses GitHub Actions as its source and `hyevem.com` as its custom domain, with HTTPS enabled. DNS and npm account settings are managed outside this repository. The site opens directly at `/docs/` and supports a static redirect fallback.

## Public documentation

Package guides live in `packages/data/docs` and `packages/ui/docs`. The private `docs/` workspace assembles them, their compiled examples, and previews.

Main and pull requests build and test the current documentation but do not deploy it. Successful npm publication requests deployment from its release tag. The site updates only when every package version in that checkout is the current npm release and each package tree matches its own release tag. Otherwise, the existing site stays live until the remaining package changes are released. This keeps the task board and cross-package examples on a coherent, tested snapshot.

For site-only corrections, run the Documentation workflow on `main` with `deploy` enabled; the same release checks apply. A registry failure fails verification instead of treating an unknown version as released.
