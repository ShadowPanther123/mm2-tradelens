import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValueBadge } from "./ValueBadge";
import type { Item } from "@/types";

function makeItem(overrides: Partial<Item["values"]["mm2values"]> = {}): Item {
  return {
    id: "seer",
    displayName: "Seer",
    aliases: [],
    category: "gun",
    rarity: "godly",
    chroma: false,
    verified: true,
    values: {
      mm2values: {
        value: 1200,
        updatedAt: "2026-08-14T00:00:00.000Z",
        demandRating: 8,
        rarityRating: 7,
        stabilityLabel: "Stable",
        valueRange: { low: 1150, high: 1250 },
        ...overrides,
      },
    },
  } as Item;
}

describe("ValueBadge", () => {
  it("renders the resolved value with source signals", () => {
    render(<ValueBadge item={makeItem()} mode="mm2values" />);
    const badge = screen.getByTestId("value-badge");
    expect(badge).toHaveTextContent("1,200");
    expect(badge).toHaveTextContent("Demand 8");
    expect(badge).toHaveTextContent("Rarity 7");
    expect(badge).toHaveTextContent("Stable");
    expect(badge).toHaveTextContent("1,150–1,250");
  });

  it("shows a value range of N/A when none is published", () => {
    render(<ValueBadge item={makeItem({ valueRange: undefined })} mode="mm2values" />);
    expect(screen.getByTestId("value-badge")).toHaveTextContent("N/A");
  });

  it("falls back to a plain message when the item has no readable value", () => {
    const item = { ...makeItem(), values: {} } as Item;
    render(<ValueBadge item={item} mode="mm2values" />);
    expect(screen.queryByTestId("value-badge")).toBeNull();
    expect(screen.getByText("No value")).toBeInTheDocument();
  });
});
