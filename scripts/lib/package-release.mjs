// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

/** Fail closed unless a tag, configured workspace, and manifest identify one release. */
export function publicationFor(config, directory, tag, manifest) {
	const entry = config.packages[directory];
	if (!entry || !/^packages\/[a-z][a-z-]*$/.test(directory))
		throw Error("Choose a configured release package.");
	if (manifest.private || entry["package-name"] !== manifest.name)
		throw Error("The release configuration does not match the package.");
	if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version))
		throw Error("The package does not have a release version.");
	if (tag !== `${entry.component}-v${manifest.version}`)
		throw Error("The release tag does not match this package and version.");
	return { directory, name: manifest.name, version: manifest.version };
}
