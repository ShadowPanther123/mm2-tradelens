import { test, expect, bootApp, navTo } from "./helpers";

test.describe("OCR review", () => {
  test("scan page loads with its privacy note and manual-review affordances", async ({
    page,
  }) => {
    await bootApp(page);
    await navTo(page, "Scan");

    await expect(page.getByRole("heading", { name: "Scan a screenshot" })).toBeVisible();

    // Either the OCR flow is available, or the build cleanly says it isn't —
    // both are valid, and neither should ever auto-add items.
    const hasUpload = await page.getByRole("button", { name: /choose image/i }).count();
    if (hasUpload > 0) {
      await expect(page.getByText(/your image stays on your device/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /choose image/i })).toBeVisible();
    } else {
      await expect(page.getByText(/isn't included in this build/i)).toBeVisible();
    }
  });
});
