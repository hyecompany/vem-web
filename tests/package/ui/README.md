<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Packed UI consumer checks

Run `npm run test:ui-package` from the repository root. The script installs packed artifacts in an independent temporary directory, verifies core imports without Vem Data installed, then installs packed Vem Data and compiles the optional integration examples. Neither phase resolves packages from a sibling checkout.

`components.test.mjs` exercises server rendering before JavaScript, hydration, host CSS overrides, document-themed portals, resizing, Unicode truncation, and reduced motion without Tailwind. `production.test.mjs` builds and serves three small production applications, records the JavaScript chunks their browsers actually request, and checks the modules retained in those chunks.

| Production consumer | JavaScript bytes | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| Button with Vem Data absent | 272,305 | 83,692 | 72,169 |
| DataProvider and CommandButton | 276,567 | 85,158 | 73,503 |
| DataProvider, useEdit, Textarea, and bindText | 270,226 | 82,947 | 71,667 |

This observed baseline uses React and React DOM 19.3.1, Vite 8.3.6, and Node compression defaults, measured on November 12, 2026. Each application requested one JavaScript chunk including React, React DOM, and its small fixture. These are application payloads, not standalone library sizes. The shared minified stylesheet was 88,940 bytes, 13,519 gzip bytes, and 11,561 Brotli bytes in each application. Server compression configuration determines actual wire encoding.

The production fixtures use minimal local host stubs to isolate consumer costs. They do not exercise network acquisition, worker ownership, persistence, or recovery. Those behaviors have separate Data tests. The UI integration tests in `packages/ui/tests/data` use the real runtime and deterministic sources to exercise actions, protected editing, and feedback.

Structural assertions prevent UI-only code from importing Data and keep owner machinery, Dexie, XState, and TanStack DB out of these consumer chunks. Command-only consumers exclude editor and feedback implementations; editor-only consumers exclude command buttons and feedback. Byte counts are reported for review, not enforced as brittle exact limits. Review the new measurements after dependency or public-export changes before updating this baseline.
