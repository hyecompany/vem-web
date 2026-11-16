// SPDX-FileCopyrightText: 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import { appendFileSync } from "node:fs";
import {
	browserRequirements,
	changedFiles,
	selectValidation,
} from "./lib/affected-validation.mjs";

const selection =
	process.env.GITHUB_EVENT_NAME === "pull_request"
		? selectValidation(changedFiles(process.env.VEM_TEST_BASE))
		: {
				targets: ["all"],
				reasons: ["Main and manual runs validate the complete release."],
			};
const browsers = browserRequirements(selection.targets);
console.log(JSON.stringify({ ...selection, browsers }, null, 2));
if (process.env.GITHUB_OUTPUT)
	appendFileSync(process.env.GITHUB_OUTPUT, `browsers=${browsers.join(" ")}\n`);
