<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Hye Vem documentation

Run `npm run docs:dev` from the repository root. The site uses Fumadocs, Next.js, and static export. Build with `npm run docs:build`; set `BASE_PATH=/vem-web` for the Pages deployment path.

The build finishes the static artifact with legacy documentation redirects and normalized segment-prefetch filenames. This corrects platform path separators in Windows exports; Linux artifacts are unchanged. The static test server serves the actual files and treats missing assets as failures.

Edit **`content/handbook`**, not generated `content/docs`. Run `npm run docs:prepare` to update a running preview after source changes. Frontmatter uses JSON-compatible title, description, and order values. Folder indexes establish package areas and their reading order.

- Code excerpts come from region markers in compiled `packages/<package>/examples` files. `Example package="ui"` selects UI; omitted package means Data.
- Diagrams and their written equivalents come from `content/diagrams.json`.
- Focused experiment explanations come from `content/experiments.json`, with implementations in `components/labs`.
- API pages come from each documented package's public JavaScript entry points through TypeDoc and typedoc-plugin-markdown. Register package locations in `scripts/documented-packages.mjs`; existing Data paths remain stable.
- The component catalog is maintained in `content/ui-components.json`. Every public UI component or binding belongs to one task guide; the generator verifies API links against TypeDoc output.
- UI previews in `components/previews` render compiled examples through public package imports. Catalog descriptions supply their text equivalents; the additional OverflowText and Spinner interactions are explained in `content/ui-previews.json`.
- Navigation, `llms.txt`, `llms-full.txt`, and `docs.json` are generated from the same content.

See [Contribute to these docs](content/handbook/data/reference/contributing.mdx) for the complete workflow. Run `npm run test:docs` after building; it verifies the static site and interactive reader journeys. Browser checks use Playwright Chromium by default; install it with `npx playwright install chromium`, or set `VEM_BROWSER_CHANNEL=chrome` to use installed Chrome.

After building the packages, run `npm run test:docs-package` to verify their packed artifacts in an independent Next application, including server rendering, hydration, stylesheet imports, portals, and public examples.

The in-page task board composes three focused lessons. `components/lesson` holds the shared Vem UI application view and teaching presentation; `components/labs/sources` holds the controlled source behavior. These run the real runtime. Compiled examples in `packages/data/examples` provide the code shown in guides. The `task-board` directory also contains an HTTP/SharedWorker fixture for contributor checks.

Static diagram nodes and their explanations live together in `content/diagrams.json`; text exports preserve the same explanation. Use interaction for demonstrated behaviors, not as a prerequisite to reading a diagram. Shared colors live in `app/learning.css`; diagram and experiment styles are in `app/styles/`.

The experiments exercise the real runtime with deterministic in-page sources. The task-board starter separately exercises HTTP, events, and a SharedWorker. Neither the docs build nor validation publishes anything.

To check another installed Playwright engine, set `VEM_BROWSER=firefox` or `VEM_BROWSER=webkit`. Layout checks include a narrow viewport, keyboard interaction, reduced motion, no-JavaScript reading, and automated light/dark accessibility checks.
