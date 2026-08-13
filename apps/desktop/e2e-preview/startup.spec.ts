import { expect, test } from "@playwright/test";

test("production preview renders without a blank screen", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Loading values…")).toHaveCount(0);
  await expect(page.getByText(/startup failed/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
