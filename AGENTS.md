<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reviewing this repository

`@hyecompany/vem-data` is the browser knowledge runtime. The public contract is the documentation in `packages/docs` and the tests in `packages/data/tests`. Do not add a behavioral rule that is in neither.

Imports stay on the `exports` keys in `packages/data/package.json`:

- `@hyecompany/vem-data`
- `@hyecompany/vem-data/react`
- `@hyecompany/vem-data/client`
- `@hyecompany/vem-data/worker`
- `@hyecompany/vem-data/runtime`
- `@hyecompany/vem-data/testing`
- `@hyecompany/vem-data/devtools`

`ResourceReadDefinition` functions run in the owner and in the tab, so they stay pure. The default `canRetry` is a settled `failed` outcome with `submitted === false` that was not restored from the journal. An `unknown` outcome does not get that default. `recover` investigates a journal and does not call `run` again.

Commits use Conventional Commits. Agents must never add a DCO sign-off or a `Signed-off-by` trailer; only human contributors may sign the DCO. Files keep the SPDX header from `REUSE.toml`. `npm run check`, `npm run typecheck`, `npm test`, and `npm run test:package` are the verification commands.
