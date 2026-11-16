// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// #region panel
import type {
	ClientInspector,
	ScenarioClient,
} from "@hyecompany/vem-data/devtools";
import { DataInspector } from "@hyecompany/vem-ui/devtools";
import "@hyecompany/vem-ui/styles.css";
import "@hyecompany/vem-ui/devtools/styles.css";

export function InspectorPanel({
	inspection,
	scenarios,
}: {
	inspection: ClientInspector;
	scenarios?: ScenarioClient;
}) {
	return <DataInspector inspection={inspection} scenarios={scenarios} />;
}

// #endregion panel

// #region prepare
import type { DataClient } from "@hyecompany/vem-data";
import { inspectClient } from "@hyecompany/vem-data/devtools";

export function prepareDevelopmentTools(client: DataClient) {
	const inspection = inspectClient(client);
	return {
		client: inspection.client,
		panel: <InspectorPanel inspection={inspection} />,
		dispose: () => inspection.close(),
	};
}
// #endregion prepare

// #region scenario-panel
export function ScenarioPanel({ scenario }: { scenario: ScenarioClient }) {
	return <InspectorPanel inspection={scenario} scenarios={scenario} />;
}
// #endregion scenario-panel
