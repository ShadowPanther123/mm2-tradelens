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
