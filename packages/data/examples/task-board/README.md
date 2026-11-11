<!-- SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com> -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Task-board starter

From the repository root: `npm ci`, then **`npm run example:dev`**. Open http://127.0.0.1:4310. Use Node.js 24+ and a browser supporting module SharedWorker and Web Locks.

1. Toggle the known status filter; it should not refetch or replace content with loading.
2. Open another tab and complete a task; both tabs update.
3. Edit notes, change source notes under **Try an external update**, then save. The old ETag is rejected and your draft remains.
4. Choose **Discard draft and reload** explicitly to load the new baseline.

`contract.ts` describes the feature API. `view.tsx` contains components. `read.ts` supplies pure shared read rules. `domain.ts` interprets the backend. `owner.ts` owns HTTP/events/storage, and `main.tsx` attaches a tab. `fixture.mjs` is a local public-data server, not a production backend.

Task events use EventSource. Vite also uses a separate development WebSocket on the same server. Inspect worker traffic in the browser's SharedWorker developer tools. Its data resets on server restart. Notes are not persisted by the example domain; commands have no durable server operation history and do not promise restart recovery.

`npm run example:build` builds the client and a stable worker filename. It does not build or deploy a production backend. `npm run test:package` installs a packed Vem artifact in an independent consumer and tests this complete source tree there.
