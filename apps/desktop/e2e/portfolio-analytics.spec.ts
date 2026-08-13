import { bootApp, expect, navTo, test } from "./helpers";

test("portfolio tracks owned items and analytics records searches", async ({
  page,
  request,
}) => {
  const response = await request.get("http://localhost:1420/data/catalogue.json");
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  snapshot.revision += 1000;
  snapshot.generatedAt = new Date().toISOString();
  for (const item of snapshot.items.slice(0, 8)) {
    const reading = item.values.mm2values;
    if (!reading) continue;
    reading.previousValue = reading.value + 1;
    reading.trendPercent = reading.value > 0 ? (-1 / (reading.value + 1)) * 100 : -100;
    reading.updatedAt = snapshot.generatedAt;
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
  await navTo(page, "Portfolio");
  const add = page.getByLabel("Add an owned item…");
  await add.fill("harvester");
  await page.getByRole("button", { name: "Own" }).first().click();
  await expect(page.getByText("Harvester").first()).toBeVisible();
  await expect(page.getByText("1").first()).toBeVisible();

  await navTo(page, "Search");
  await page.getByLabel("Search items").fill("icebreaker");
  await page
    .getByRole("link", { name: /icebreaker/i })
    .first()
    .click();
  await navTo(page, "Analytics");
  await expect(page.getByRole("heading", { name: "Most searched" })).toBeVisible();
  await expect(page.getByText("Icebreaker").first()).toBeVisible();

  await page.setViewportSize({ width: 712, height: 400 });
  const heatScores = page.getByTestId("analytics-heat-score");
  await expect(heatScores.first()).toBeVisible();
  await expect(heatScores.first()).toHaveText(/^Heat \d+\.\d$/);
  const rowsOverflow = await page
    .getByTestId("item-row")
    .evaluateAll((rows) => rows.some((row) => row.scrollWidth > row.clientWidth + 1));
  expect(rowsOverflow).toBe(false);
  const scoreOverlapsValue = await page.getByTestId("item-row").evaluateAll((rows) =>
    rows.some((row) => {
      const score = row.querySelector<HTMLElement>(
        '[data-testid="analytics-heat-score"]',
      );
      const range = row.querySelector<HTMLElement>('[data-testid="value-range"]');
      if (!score || !range) return false;
      const scoreBox = score.getBoundingClientRect();
      const rangeBox = range.getBoundingClientRect();
      return (
        scoreBox.right > rangeBox.left &&
        scoreBox.left < rangeBox.right &&
        scoreBox.bottom > rangeBox.top &&
        scoreBox.top < rangeBox.bottom
      );
    }),
  );
  expect(scoreOverlapsValue).toBe(false);
});
