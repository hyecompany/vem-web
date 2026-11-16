// SPDX-FileCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0

// Layout widths stay in CSS pixels even while a popup ancestor scales into view.
function layoutWidth(element: HTMLElement) {
	return (
		Number.parseFloat(getComputedStyle(element).width) || element.offsetWidth
	);
}

// SPDX-SnippetBegin
// SPDX-SnippetCopyrightText: © 2026 Joseph Maldjian <joseph.maldjian@hyecompany.com>
// SPDX-License-Identifier: Apache-2.0
/** Measure in the inherited font, including letter spacing and complex text shaping. */
export function measureOverflow(
	text: string,
	container: HTMLElement,
	full: HTMLElement,
	sample: HTMLElement,
) {
	const available = container.clientWidth;
	const width = layoutWidth(full);
	const overflow = available > 0 && width > available;
	if (!overflow) return { source: text, overflow, truncated: text, width };
	const segments = Array.from(
		new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
		({ segment }) => segment,
	);
	const shorten = (count: number) => {
		const start = Math.ceil(count / 2);
		const end = count - start;
		return `${segments.slice(0, start).join("")}…${end ? segments.slice(-end).join("") : ""}`;
	};
	let low = 0;
	let high = Math.max(0, segments.length - 1);
	while (low < high) {
		const count = Math.ceil((low + high) / 2);
		sample.textContent = shorten(count);
		if (layoutWidth(sample) <= available - 1) low = count;
		else high = count - 1;
	}
	sample.textContent = "";
	return { source: text, overflow, truncated: shorten(low), width };
}
// SPDX-SnippetEnd
