<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# @hyecompany/vem-data

Shared browser knowledge, coordinated operations, and protected edits. Install this package independently of the rest of Hye Vem.

Features use four concepts: **Query** describes information, **Command** describes an operation, **Action** records execution, and **Edit session** manages a writable baseline and protected draft. Named resource contracts and React hooks are the primary API.

## Explore and build

Use the [task board](https://hyevem.com/docs/data/start/quickstart/) to filter tasks, complete one, and edit its notes. Each guide connects that behavior to the code you write.

- [Build a feature](https://hyevem.com/docs/data/build/): complete list, action, editor, and testing examples.
- [Connect your backend](https://hyevem.com/docs/data/connect/): begin with one resource; add events, permissions, and a browser host.
- [Look up an API](https://hyevem.com/docs/data/reference/api-map/): public entry points and generated signatures.

The package is under development. React bindings target React 19+. The shared browser host needs a secure context, module SharedWorker, and Web Locks; persistence is optional.

## Choose a public entry point

| Import | Responsibility |
| --- | --- |
| `@hyecompany/vem-data` | Typed resource contracts, descriptions, result types, guards |
| `@hyecompany/vem-data/react` | Provider and query, command, action, edit hooks |
| `@hyecompany/vem-data/client` | Browser tab connection |
| `@hyecompany/vem-data/worker` | Shared owner bootstrap |
| `@hyecompany/vem-data/runtime` | Domain definitions, evidence, runtime, persistence |
| `@hyecompany/vem-data/testing` | Feature fixtures and deterministic persistence |
| `@hyecompany/vem-data/devtools` | Inspection and scenario control |

Integrations declare backend sources, coverage, supported filters, pagination, access, and relative cost. Vem chooses reads across the shared owner’s active demand, reusing known and in-flight information.

Do not import internal stores or worker messages into features. Vem does not supply a backend, authorization policy, transport, form layout, or notification UI. The domain and host integrations provide those meanings and capabilities.

For repository work, see the [contributor guide](https://hyevem.com/docs/data/reference/contributing/). The HTTP/SharedWorker fixture in `examples/task-board` supports integration checks; it is not a prerequisite for following the guides.
