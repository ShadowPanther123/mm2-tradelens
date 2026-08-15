import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Item } from "@/types";

// A tiny stand-in for the zustand store: selectors run against a plain state
// object so the page can render without the real data layer.
let mockState: Record<string, unknown>;
vi.mock("@/hooks/useDataStore", () => ({
  useDataStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockState),
}));

// The fuzzy search index is exercised elsewhere; here browsing (empty query)
// is what drives the filter UI, so an empty result set is fine.
vi.mock("@/hooks/useSearch", () => ({
  useSearch: () => [],
}));

import { Search } from "./Search";

function makeItem(id: string, category: Item["category"]): Item {
  return {
    id,
    displayName: id,
    aliases: [],
    category,
    rarity: "godly",
    chroma: false,
    verified: true,
    values: { mm2values: { value: 100, updatedAt: "2026-08-14T00:00:00.000Z" } },
  } as Item;
}

function renderSearch(items: Item[]) {
  mockState = {
    items,
    settings: { sourceMode: "mm2values" },
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    recordItemSearch: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <Search />
    </MemoryRouter>,
  );
}

describe("Search filters", () => {
  beforeEach(() => {
    mockState = {};
  });

  it("only offers category chips the catalogue actually contains", () => {
    renderSearch([makeItem("knife-a", "knife"), makeItem("gun-a", "gun")]);
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Knives" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guns" })).toBeInTheDocument();
    // No pets in the catalogue, so no Pets chip.
    expect(screen.queryByRole("button", { name: "Pets" })).toBeNull();
  });

  it("hides the source filter when only one source has data", () => {
    renderSearch([makeItem("knife-a", "knife")]);
    expect(
      screen.queryByLabelText("Filter by source availability"),
    ).toBeNull();
  });

  it("shows an empty state when the catalogue is empty", () => {
    renderSearch([]);
    expect(screen.getByText("No items match")).toBeInTheDocument();
  });
});
