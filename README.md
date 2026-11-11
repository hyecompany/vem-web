<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Hye Vem

Shared foundations for browser applications. Adopt each package independently; bring your own UI and backend.

**[Vem Data](packages/data/README.md)** is the first package: shared information, coordinated actions, and protected edits for browser and React applications. It is under development in this repository.

## Explore Vem Data

[Use the task board](https://hyevem.com/docs/data/start/quickstart/) to filter, complete, and edit tasks. The guides connect those interactions to the code you write in your application.

| Your task | Start here |
| --- | --- |
| Build a screen | [Display data](https://hyevem.com/docs/data/build/display/) |
| Add an operation | [Commands and actions](https://hyevem.com/docs/data/build/actions/) |
| Connect a backend | [Define a resource](https://hyevem.com/docs/data/connect/resources/) |
| Understand shared behavior | [When Vem acquires data](https://hyevem.com/docs/data/understand/acquisition/) |
| Find an exact API or diagnose a problem | [Reference](https://hyevem.com/docs/data/reference/) |

## Work on this repository

The package lives in `packages/data`; documentation source lives in `packages/docs/content/handbook`. Executable snippets are in `packages/data/examples`, and built-site checks are in `tests/docs`, and packed-consumer browser checks are in `tests/package`. See [the test layout](tests/README.md) when adding coverage.

See [CONTRIBUTING.md](CONTRIBUTING.md) for installation and required checks, or [the docs contributor guide](packages/docs/content/handbook/data/reference/contributing.mdx) to change a guide, example, or diagram. `npm run docs:dev` previews the site; `npm run docs:build` produces static output without publishing it.
