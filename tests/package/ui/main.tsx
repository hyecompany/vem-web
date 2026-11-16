// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./app.js";

const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
hydrateRoot(
	root,
	<StrictMode>
		<App />
	</StrictMode>,
);
