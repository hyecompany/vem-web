// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";

export default function Home() {
	const destination = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/docs/`;
	return (
		<main>
			<meta httpEquiv="refresh" content={`0;url=${destination}`} />
			<p>
				<Link href="/docs/">Open the Hye Vem documentation</Link>
			</p>
		</main>
	);
}
