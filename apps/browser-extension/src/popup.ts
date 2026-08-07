import { SearchIndex, resolveValue } from "@tradelens/trade-engine";
import { mm2valuesSnapshot } from "@tradelens/source-adapters/mm2values";

/**
 * Toolbar popup: instant MM2 value lookup. Uses the same trade-engine and
 * bundled snapshot as the desktop app so results are consistent everywhere.
 */

const index = new SearchIndex(mm2valuesSnapshot.items);
const input = document.getElementById("q") as HTMLInputElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function render(query: string): void {
  const results = index.search(query, 8);
  if (query.trim().length === 0) {
    resultsEl.innerHTML = `<div class="empty">Start typing to look up an item.</div>`;
    return;
  }
  if (results.length === 0) {
    resultsEl.innerHTML = `<div class="empty">No items matched “${escapeHtml(query)}”.</div>`;
    return;
  }
  resultsEl.innerHTML = results
    .map(({ item }) => {
      const combined = resolveValue(item, "consensus");
      const supreme = item.values.supreme?.value;
      const mm2v = item.values.mm2values?.value;
      return `
        <div class="card">
          <div class="card__name">${escapeHtml(item.displayName)}</div>
          <div class="card__meta">${escapeHtml(item.rarity)} ${escapeHtml(item.category)}${
            item.origin ? " · " + escapeHtml(item.origin) : ""
          }</div>
          <div class="card__values">
            <span>Supreme: ${supreme != null ? fmt(supreme) : "—"}</span>
            <span>MM2V: ${mm2v != null ? fmt(mm2v) : "—"}</span>
            <span>Combined: ${combined ? fmt(combined.value) : "—"}</span>
          </div>
        </div>`;
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

input.addEventListener("input", () => render(input.value));
render("");
