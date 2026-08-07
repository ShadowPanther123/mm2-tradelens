import { test, expect, bootApp, navTo } from "./helpers";

/** Add the first live result from a side's inline "Add an item…" search bar. */
async function addToSide(page: import("@playwright/test").Page, side: "Your offer" | "Their offer") {
  const card = page.getByRole("heading", { name: side }).locator("xpath=ancestor::div[1]/..");
  const input = card.getByLabel("Add an item…");
  await input.click();
  await input.fill("seer");
  const add = card.getByRole("button", { name: "Add" }).first();
  await expect(add).toBeVisible();
  await add.click();
}

test.describe("trade calculator", () => {
  test("adds both sides and produces a verdict", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Calculator");

    await addToSide(page, "Your offer");
    await addToSide(page, "Their offer");

    // With items on both sides, saving becomes possible and a verdict shows.
    await expect(page.getByRole("button", { name: "Save trade" })).toBeEnabled();
    await expect(
      page.getByText(/big win|win|fair|loss|big loss/i).first(),
    ).toBeVisible();
  });

  test("saves a trade to history", async ({ page }) => {
    await bootApp(page);
    await navTo(page, "Calculator");
    await addToSide(page, "Your offer");
    await addToSide(page, "Their offer");

    await page.getByRole("button", { name: "Save trade" }).click();
    await expect(page.getByText(/trade saved to history/i)).toBeVisible();

    await navTo(page, "History");
    await expect(page.getByText(/no trades/i)).toHaveCount(0);
  });
});
