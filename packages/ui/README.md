<!--
SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
SPDX-License-Identifier: Apache-2.0
-->

# Vem UI

React 19 components distributed through npm: shadcn Base UI controls with Nova styling, OverflowText, Spinner, and optional Vem Data bindings. Applications keep their own router, layouts, and CSS theme.

```sh
npm install @hyecompany/vem-ui
```

```tsx
import { Button } from "@hyecompany/vem-ui";
import "@hyecompany/vem-ui/styles.css";

export function App() {
  return <Button>New task</Button>;
}
```

The package ships compiled CSS; no Tailwind source scanning or component copying is required. Standard shadcn semantic variables and document light/dark themes work through CSS, without a theme provider. Interactive Next.js application components need their own client boundary; generic React examples do not.

- [Components](https://hyevem.com/docs/ui/components/): guides, package-backed previews, and generated APIs.
- [Branding](https://hyevem.com/docs/ui/customize/): semantic CSS variables and scoped portals.
- [Data bindings](https://hyevem.com/docs/ui/with-data/): optional `@hyecompany/vem-ui/data` helpers. Core controls do not require Vem Data.
- [Development tools](https://hyevem.com/docs/data/connect/devtools/): embed `DataInspector` from `@hyecompany/vem-ui/devtools` in your existing tools host. Load it and `devtools/styles.css` only through a compile-time development branch; the host owns inspection and scenario clients.

[Compiled examples](examples) supply the documentation snippets and previews. Adapted shadcn files retain MIT attribution and mark Vem changes with Apache-2.0 SPDX snippets. Package attribution is included in `THIRD-PARTY-NOTICES.txt`; [contributing guidance](../../CONTRIBUTING.md) describes source tracking and licensing. Hye branding assets have separate reserved terms.
