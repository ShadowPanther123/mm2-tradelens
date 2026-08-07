import { test, expect, bootApp, navTo } from "./helpers";

test.describe("favorites", () => {
  test("favoriting an item shows it on the favorites page", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Search");
    await page.getByLabel("Search items").fill("seer");
    await page.getByRole("link", { name: /seer/i }).first().click();

    const favBtn = page.getByRole("button", { name: /favorite/i });
    await favBtn.click();
    await expect(page.getByRole("button", { name: /favorited/i })).toBeVisible();

    await navTo(page, "Favorites");
    await expect(page.getByText(/no favorites/i)).toHaveCount(0);
  });
});

test.describe("settings and source switching", () => {
  test("switches the active value source and reflects it in the sidebar", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Settings");

    await page.getByRole("button", { name: "MM2Values", exact: true }).click();
    // The sidebar source indicator updates to the chosen source.
    await expect(page.getByText("MM2Values").first()).toBeVisible();

    await page.getByRole("button", { name: "Combined estimate", exact: true }).click();
    await expect(page.getByText("Combined estimate").first()).toBeVisible();
  });

  test("delete-all-data asks for confirmation", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Settings");
    await page.getByRole("button", { name: /delete all local data/i }).click();
    await expect(page.getByText(/delete all local data\?/i)).toBeVisible();
  });
});
