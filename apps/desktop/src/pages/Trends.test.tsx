import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HistoryReading } from "@tradelens/trade-engine";

let mockState: Record<string, unknown>;
vi.mock("@/hooks/useDataStore", () => ({
  useDataStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockState),
}));

// No locally recorded history in these tests; the page reads it once on mount.
vi.mock("@/database", () => ({
  getAllValueHistory: () => Promise.resolve([] as HistoryReading[]),
}));

import { Trends } from "./Trends";

function renderTrends(items: unknown[]) {
  mockState = {
    items,
    settings: { sourceMode: "mm2values" },
    snapshotMeta: { revision: 1 },
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    recordItemSearch: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <Trends />
    </MemoryRouter>,
  );
}

describe("Trends empty state", () => {
  beforeEach(() => {
    mockState = {};
  });

  it("shows a calm empty state when nothing has moved", async () => {
    renderTrends([]);
    await waitFor(() => {
      expect(
        screen.getByText("Nothing has moved in this window"),
      ).toBeInTheDocument();
    });
    // The moved-items sections are not rendered in the empty case.
    expect(screen.queryByTestId("latest-sync-changes")).toBeNull();
  });

  it("always renders the summary stat pills", async () => {
    renderTrends([]);
    await waitFor(() => {
      expect(screen.getByText("Rising items")).toBeInTheDocument();
    });
    expect(screen.getByText("Easing items")).toBeInTheDocument();
    expect(screen.getByText("Avg movement")).toBeInTheDocument();
  });
});
