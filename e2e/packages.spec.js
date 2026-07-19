import { test, expect } from "@playwright/test";
import {
  cleanupBackendFixtures,
  createRunId,
  seedBackendFixtures,
} from "./helpers/backend-fixtures.js";

test.describe("Packages against the real backend @backend", () => {
  const runId = createRunId("packages");
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test("renders an approved package on its clean canonical URL", async ({
    page,
  }) => {
    await page.goto(fixtures.package.path);

    await expect(page.locator("#package-content")).toBeVisible();
    await expect(page.locator("#package-title")).toHaveText(
      fixtures.package.title,
    );
    await expect(page.locator("#package-price")).toHaveText("£750");
    await expect(page.locator("#package-description")).toContainText(
      "full-day photography package",
    );
    await expect(page.locator("#pkg-sup-name")).toHaveText(
      fixtures.supplier.name,
    );
    await expect(page.locator("#pkg-view-profile-btn")).toHaveAttribute(
      "href",
      new RegExp(`supplier.*${fixtures.supplier.id}`),
    );

    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toBe(`http://localhost:3000${fixtures.package.path}`);
  });

  test("redirects legacy query URLs to the clean package path in one hop", async ({
    request,
  }) => {
    for (const query of [
      `slug=${encodeURIComponent(fixtures.package.slug)}`,
      `id=${encodeURIComponent(fixtures.package.id)}`,
      `packageId=${encodeURIComponent(fixtures.package.id)}`,
    ]) {
      const response = await request.get(`/package?${query}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(fixtures.package.path);
    }
  });

  test("returns the current package, supplier and category contract from the API", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/packages/${encodeURIComponent(fixtures.package.slug)}`,
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();

    expect(body.package).toMatchObject({
      id: fixtures.package.id,
      title: fixtures.package.title,
      approved: true,
      paused: false,
    });
    expect(body.supplier).toMatchObject({
      id: fixtures.supplier.id,
      name: fixtures.supplier.name,
    });
    expect(Array.isArray(body.categories)).toBe(true);
  });

  test("keeps paused, unapproved and missing packages out of the public surface", async ({
    request,
  }) => {
    for (const slug of [
      fixtures.pausedPackage.slug,
      fixtures.unapprovedPackage.slug,
      `missing-${runId}`,
    ]) {
      const htmlResponse = await request.get(
        `/package/${encodeURIComponent(slug)}`,
      );
      expect(htmlResponse.status()).toBe(404);
      expect(htmlResponse.headers()["x-robots-tag"]).toMatch(/noindex/);

      const apiResponse = await request.get(
        `/api/packages/${encodeURIComponent(slug)}`,
      );
      expect(apiResponse.status()).toBe(404);
    }
  });

  test("sends a logged-out Add to Plan action through the intent-aware auth gate", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(fixtures.package.path);
    await expect(page.locator("#pkg-add-to-plan-btn")).toBeVisible();
    await page.locator("#pkg-add-to-plan-btn").click();
    await page.waitForURL(/\/auth\?/);

    const url = new URL(page.url());
    expect(url.searchParams.get("intent")).toBe("plan");
    expect(url.searchParams.get("redirect")).toBe(fixtures.package.path);
  });
});
