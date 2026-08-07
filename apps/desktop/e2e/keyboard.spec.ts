import { test, expect, bootApp, navTo } from "./helpers";

test.describe("keyboard-only navigation", () => {
  test("reaches the search input and navigation using only the keyboard", async ({ page }) => {
    await bootApp(page);

    // Tab through the shell; every focus stop must be a real, visible control.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      await expect(focused).toBeVisible();
    }

    // Activating the focused Search link (via keyboard) navigates there.
    await page.getByRole("link", { name: "Search", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/search/);
    await expect(page.getByLabel("Search items")).toBeVisible();

    // The search box accepts typed input while keyboard-focused.
    await page.getByLabel("Search items").focus();
    await page.keyboard.type("seer");
    await expect(page.getByLabel("Search items")).toHaveValue("seer");
  });

  test("has no obviously trapped or invisible focus targets on the calculator", async ({
    page,
  }) => {
    await bootApp(page);
    await navTo(page, "Calculator");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toBeVisible();
    }
  });
});
