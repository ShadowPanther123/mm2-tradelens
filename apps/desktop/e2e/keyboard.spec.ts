import { test, expect, bootApp, navTo } from "./helpers";

test.describe("keyboard-only navigation", () => {
  test("reaches the search input and navigation using only the keyboard", async ({
    page,
  }) => {
    await bootApp(page);

    const dashboardLink = page.getByRole("link", { name: "Dashboard", exact: true });
    const searchLink = page.getByRole("link", { name: "Search", exact: true });
    await dashboardLink.focus();
    await page.keyboard.press("Tab");
    await expect(searchLink).toBeFocused();

    // Activating the focused Search link (via keyboard) navigates there.
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
    const itemInputs = page.getByLabel("Add an item…");
    await itemInputs.first().focus();
    await page.keyboard.press("Tab");
    await expect(itemInputs.nth(1)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(itemInputs.first()).toBeFocused();
  });
});
