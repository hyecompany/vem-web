// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import type { QueryResult } from "@hyecompany/vem-data";

export function QueryEvidence({ result }: { result?: QueryResult }) {
	if (!result)
		return (
			<details>
				<summary className="vem-inspector-summary">Field evidence</summary>
				<p className="vem-inspector-evidence-hint">No active consumer.</p>
			</details>
		);
	return (
		<details>
			<summary className="vem-inspector-summary">Field evidence</summary>
			<p className="vem-inspector-evidence-hint">
				{result.revalidating
					? "Stale evidence is being revalidated."
					: result.fetching
						? "Missing information is being acquired."
						: result.settled
							? "The current acquisition attempt has settled."
							: "The current demand has not settled."}{" "}
				{result.stale &&
					!result.revalidating &&
					"Last-known evidence remains stale. "}
				Ordinary data has no reload or focus timer. Live fields rely on domain
				event coverage; snapshot fields describe the last observation.
			</p>
			{[...result.rows, ...result.unresolved].map((row) => (
				<div key={row.key} className="vem-inspector-evidence-row">
					<p className="vem-inspector-identity-heading">
						{JSON.stringify(row.identity)}
					</p>
					<table className="vem-inspector-table">
						<caption className="vem-inspector-sr-only">
							Field evidence for {row.key}
						</caption>
						<thead>
							<tr>
								<th>Field</th>
								<th>Source</th>
								<th>Liveness</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(row.fields).map(([name, field]) => (
								<tr key={name}>
									<td>{name}</td>
									<td>{field?.source ?? "Unavailable"}</td>
									<td>
										{field?.stale ? "Changes may be missing" : field?.liveness}
									</td>
								</tr>
							))}
							{row.missing.map((name) => (
								<tr key={name}>
									<td>{name}</td>
									<td colSpan={2}>Unavailable</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}
		</details>
	);
}
