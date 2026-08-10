import { test, expect, bootApp, navTo } from "./helpers";

/**
 * Screenshot regression baselines for the primary pages. Animations are
 * disabled and dynamic regions (data revision, timestamps) are masked so the
 * baselines stay stable across runs. Refresh with `--update-snapshots` after an
 * intentional visual change.
 */
test.describe("visual regression", () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page);
  });

  test("dashboard", async ({ page }) => {
    await expect(page).toHaveScreenshot("dashboard.png", {
      animations: "disabled",
      mask: [page.locator("nav")],
    });
  });

  test("search page", async ({ page }) => {
    await navTo(page, "Search");
    await expect(page.getByLabel("Search items")).toBeVisible();
    await expect(page).toHaveScreenshot("search.png", {
      animations: "disabled",
      mask: [page.locator("nav")],
    });
  });

  test("calculator page", async ({ page }) => {
    await navTo(page, "Calculator");
    await expect(page.getByRole("heading", { name: "Trade calculator" })).toBeVisible();
    await expect(page).toHaveScreenshot("calculator.png", {
      animations: "disabled",
      mask: [page.locator("nav")],
    });
  });

  test("settings page", async ({ page }) => {
    await navTo(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page).toHaveScreenshot("settings.png", {
      animations: "disabled",
      mask: [page.locator("nav")],
    });
  });

  test("light settings page", async ({ page }) => {
    await navTo(page, "Settings");
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveScreenshot("settings-light.png", {
      animations: "disabled",
      mask: [page.locator("nav")],
    });
  });

  test("compact overlay", async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 260 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Search", exact: true })).toBeVisible();
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot("dashboard-compact.png", {
      animations: "disabled",
      mask: [page.locator("nav")],
    });
  });
});
