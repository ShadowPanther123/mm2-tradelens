import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ItemIcon } from "./ItemIcon";

const { feed, prefs } = vi.hoisted(() => ({
  feed: "https://assets.example/tradelens/",
  prefs: { settings: { offlineMode: false } },
}));

vi.mock("@/hooks/useDataStore", () => ({
  useDataStore: (select: (state: typeof prefs) => unknown) => select(prefs),
}));
vi.mock("@/services/updates", () => ({
  DEFAULT_SNAPSHOT_URL: `${feed}v1/snapshot`,
  isValuesServiceConfigured: true,
}));

beforeEach(() => {
  prefs.settings.offlineMode = false;
});

it("tries the configured feed when a snapshot icon is missing from the bundle", () => {
  const { rerender } = render(<ItemIcon category="knife" image="icons/items/immortal.webp" alt="Immortal" />);
  const image = screen.getByRole("img", { name: "Immortal" });
  expect(image).toHaveAttribute("src", "/icons/items/immortal.webp");
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", `${feed}icons/items/immortal.webp`);
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", "/icons/placeholder.svg");
  fireEvent.error(image);
  expect(screen.queryByRole("img")).toBeNull();

  rerender(<ItemIcon category="knife" image="icons/items/mortal.webp" alt="Mortal" />);
  expect(screen.getByRole("img", { name: "Mortal" })).toHaveAttribute("src", "/icons/items/mortal.webp");
});

it("uses the local placeholder when offline mode is on", () => {
  prefs.settings.offlineMode = true;
  render(<ItemIcon category="knife" image="icons/items/mortal.webp" alt="Mortal" />);
  const image = screen.getByRole("img", { name: "Mortal" });
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", "/icons/placeholder.svg");
});

it("does not render an external image URL supplied by an item", () => {
  render(<ItemIcon category="knife" image="https://example.org/immortal.webp" alt="Immortal" />);
  expect(screen.queryByRole("img")).toBeNull();
});
