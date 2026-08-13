import { test, expect, navTo } from "./helpers";

test("Trends shows only newest-sync changes with merged historical graphs", async ({
  page,
  request,
}) => {
  const now = Date.now();
  const response = await request.get("http://localhost:1420/data/catalogue.json");
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  snapshot.revision += 1000;
  snapshot.generatedAt = new Date(now).toISOString();
  const harvester = snapshot.items.find((item) => item.id === "harvester");
  expect(harvester).toBeTruthy();
  const reading = harvester.values.mm2values;
  reading.previousValue = reading.value - 5;
  reading.trendPercent = (5 / reading.previousValue) * 100;
  reading.updatedAt = snapshot.generatedAt;

  await page.addInitScript(
    ({ oldAt, newAt, currentValue, seed }) => {
      localStorage.setItem("tradelens:onboarding-seen", "1");
      localStorage.setItem("tradelens:snapshot", JSON.stringify(seed));
      localStorage.setItem(
        "tradelens:snapshot-meta",
        JSON.stringify({
          revision: seed.revision,
          generatedAt: seed.generatedAt,
          cachedAt: seed.generatedAt,
        }),
      );
      localStorage.setItem(
        "tradelens:value-history",
        JSON.stringify([
          {
            itemId: "harvester",
            source: "mm2values",
            value: 200,
            recordedAt: oldAt,
            revision: 1,
          },
          {
            itemId: "harvester",
            source: "mm2values",
            value: currentValue,
            recordedAt: newAt,
            revision: 2,
          },
        ]),
      );
    },
    {
      oldAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      newAt: new Date(now + 60 * 1000).toISOString(),
      currentValue: reading.value,
      seed: snapshot,
    },
  );

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(/Loading values/)).toHaveCount(0);
  await navTo(page, "Trends");

  await expect(page.getByTestId("trends-history-ready")).toContainText(
    /[1-9]\d* local series/,
  );
  const newest = page.getByTestId("latest-sync-changes");
  await expect(newest.getByText("Harvester", { exact: true })).toBeVisible();
  await expect(newest.getByText("Ghastly Gun", { exact: true })).toHaveCount(0);
  await expect(
    page
      .locator("a")
      .filter({ hasText: "Harvester", has: page.locator("svg") })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "30 days" })).toBeVisible();
});
