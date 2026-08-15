import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceComparison } from "./SourceComparison";
import type { Item } from "@/types";

function makeItem(values: Item["values"]): Item {
  return {
    id: "seer",
    displayName: "Seer",
    aliases: [],
    category: "gun",
    rarity: "godly",
    chroma: false,
    verified: true,
    values,
  } as Item;
}

describe("SourceComparison", () => {
  it("shows a card per priced source with its value and confidence", () => {
    render(
      <SourceComparison
        item={makeItem({
          mm2values: { value: 1200, updatedAt: "2026-08-14T00:00:00.000Z" },
        })}
      />,
    );
    expect(screen.getByText("MM2Values")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("Confidence")).toBeInTheDocument();
  });

  it("surfaces a warning when two sources disagree beyond the threshold", () => {
    render(
      <SourceComparison
        thresholdPercent={5}
        item={makeItem({
          mm2values: { value: 1000, updatedAt: "2026-08-14T00:00:00.000Z" },
          supreme: { value: 2000, updatedAt: "2026-08-14T00:00:00.000Z" },
        })}
      />,
    );
    expect(screen.getByText("Sources disagree significantly.")).toBeInTheDocument();
    expect(screen.getByText(/100\.0%/)).toBeInTheDocument();
  });

  it("does not warn when the two sources agree closely", () => {
    render(
      <SourceComparison
        thresholdPercent={5}
        item={makeItem({
          mm2values: { value: 1000, updatedAt: "2026-08-14T00:00:00.000Z" },
          supreme: { value: 1020, updatedAt: "2026-08-14T00:00:00.000Z" },
        })}
      />,
    );
    expect(screen.queryByText("Sources disagree significantly.")).toBeNull();
  });
});
