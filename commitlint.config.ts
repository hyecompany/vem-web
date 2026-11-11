// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

const dependabotBump =
	/^build\(deps(?:-dev)?\): (?:\[[Ss]ecurity\] )?[Bb]ump \S+ from \S+ to \S+/;

export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"body-max-line-length": [0],
		"footer-max-line-length": [0],
	},
	ignores: [(message: string) => dependabotBump.test(message)],
};
