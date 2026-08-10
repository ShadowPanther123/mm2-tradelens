import { test, expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the E2E suite. The app is a HashRouter SPA, so navigation
 * happens by clicking the sidebar rather than visiting deep URLs.
 */

/** Open the app and wait for the initial data load to finish. */
export async function bootApp(page: Page): Promise<void> {
  await page.goto("/");
  // The sidebar is only rendered once the shell is up.
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  // Wait for the values to finish loading (the loader disappears).
  await expect(page.getByText("Loading values…")).toHaveCount(0);
  const onboarding = page.getByRole("dialog", { name: "Welcome to MM2 TradeLens" });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", { name: "Got it" }).click();
  await expect(onboarding).toHaveCount(0);
}

/** Click a sidebar entry by its visible label. */
export async function navTo(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: label, exact: true }).click();
}

/**
 * Type into a search box and pick the first live result. Works for both the
 * standalone Search page (aria-label "Search items") and the trade calculator's
 * inline search bars (aria-label "Add an item…").
 */
export async function searchAndPickFirst(
  page: Page,
  input: ReturnType<Page["getByLabel"]>,
  query: string,
): Promise<string> {
  await input.click();
  await input.fill(query);
  const firstResult = page.getByRole("link", { name: new RegExp(query, "i") }).first();
  await expect(firstResult).toBeVisible();
  return (await firstResult.textContent())?.trim() ?? "";
}

// Re-export so specs import everything from one place.
export { test, expect };
