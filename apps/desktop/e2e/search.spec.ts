import { test, expect, bootApp, navTo } from "./helpers";

test.describe("search to item details", () => {
  test("finds an item and opens its details page", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Search");

    const search = page.getByLabel("Search items");
    await search.fill("seer");

    const result = page.getByRole("link", { name: /seer/i }).first();
    await expect(result).toBeVisible();
    await result.click();

    // We land on an item route and see a heading for the item.
    await expect(page).toHaveURL(/#\/item\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("shows an empty state for a nonsense query", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Search");
    await page.getByLabel("Search items").fill("zzzzzznotarealitem");
    await expect(page.getByText(/no items match/i)).toBeVisible();
  });
});

test.describe("search facets", () => {
  test("combines category, rarity and source filters", async ({ page, request }) => {
    const response = await request.get("http://localhost:1420/data/catalogue.json");
    expect(response.ok()).toBe(true);
    const snapshot = await response.json();
    snapshot.revision += 1000;
    snapshot.generatedAt = new Date().toISOString();
    snapshot.sources = ["mm2values", "supreme"];
    for (const item of snapshot.items) {
      if (item.values.mm2values) {
        item.values.supreme = { ...item.values.mm2values, sourceItemId: undefined };
      }
    }
    await page.addInitScript((seed) => {
      localStorage.setItem("tradelens:snapshot", JSON.stringify(seed));
      localStorage.setItem(
        "tradelens:snapshot-meta",
        JSON.stringify({
          revision: seed.revision,
          generatedAt: seed.generatedAt,
          cachedAt: seed.generatedAt,
        }),
      );
    }, snapshot);
    await bootApp(page);
    await navTo(page, "Search");

    await page.getByRole("button", { name: "Knives", exact: true }).click();
    await page.getByLabel("Filter by rarity").selectOption("godly");
    const source = page.getByLabel("Filter by source availability");
    await expect(source).toBeVisible();
    await source.selectOption("supreme");

    const rows = page.getByTestId("item-row");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    for (let index = 0; index < count; index++) {
      await expect(rows.nth(index)).toHaveAttribute("data-category", "knife");
      await expect(rows.nth(index)).toHaveAttribute("data-rarity", "godly");
      await expect(rows.nth(index)).toHaveAttribute("data-sources", /supreme/);
    }

    await page.getByRole("button", { name: "Guns", exact: true }).click();
    await expect(rows.first()).toHaveAttribute("data-category", "gun");
  });
});
