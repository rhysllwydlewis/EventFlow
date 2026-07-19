import { test, expect } from "@playwright/test";
import {
  cleanupBackendFixtures,
  createRunId,
  getCsrfToken,
  loginAs,
  putWithCsrf,
  seedBackendFixtures,
} from "./helpers/backend-fixtures.js";

const FLAG_KEYS = [
  "registration",
  "supplierApplications",
  "reviews",
  "photoUploads",
  "supportTickets",
  "pexelsCollage",
  "requirePackageApproval",
  "requirePublicCalendarApproval",
  "marketplaceAvailability",
  "quoteBooking",
  "bookingPayments",
];

function writableFlags(flags) {
  return Object.fromEntries(FLAG_KEYS.map((key) => [key, flags[key] === true]));
}

async function blockedRegistration(page, role) {
  const csrfToken = await getCsrfToken(page);
  return page.request.post("/api/auth/register", {
    headers: { "x-csrf-token": csrfToken },
    data: {
      firstName: "Blocked",
      lastName: "Registration",
      email: `blocked-${role}-${Date.now()}@example.test`,
      password: "StrongPassword123!",
      role,
      company: role === "supplier" ? "Blocked Supplier Ltd" : undefined,
      location: "Cardiff",
      termsAccepted: true,
    },
  });
}

test.describe("Admin feature flags against the real backend @backend", () => {
  test.describe.configure({ mode: "serial" });

  const runId = createRunId("feature-flags");
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test("requires an authenticated administrator", async ({ request }) => {
    const response = await request.get("/api/admin/settings/features");
    expect(response.status()).toBe(401);
  });

  test("persists critical toggles, enforces them, and restores the original state", async ({
    page,
  }) => {
    await loginAs(page, fixtures.users.admin);

    const originalResponse = await page.request.get(
      "/api/admin/settings/features",
    );
    expect(originalResponse.ok()).toBe(true);
    const original = await originalResponse.json();
    const baseline = writableFlags(original);

    try {
      const registrationOff = await putWithCsrf(
        page,
        "/api/admin/settings/features",
        {
          ...baseline,
          registration: false,
        },
      );
      expect(registrationOff.ok()).toBe(true);

      const customerAttempt = await blockedRegistration(page, "customer");
      expect(customerAttempt.status()).toBe(503);
      await expect(customerAttempt.json()).resolves.toMatchObject({
        feature: "registration",
      });

      const registrationOn = await putWithCsrf(
        page,
        "/api/admin/settings/features",
        {
          ...baseline,
          registration: true,
          supplierApplications: false,
        },
      );
      expect(registrationOn.ok()).toBe(true);

      const supplierAttempt = await blockedRegistration(page, "supplier");
      expect(supplierAttempt.status()).toBe(503);
      await expect(supplierAttempt.json()).resolves.toMatchObject({
        feature: "supplierApplications",
      });

      const persisted = await page.request.get("/api/admin/settings/features");
      expect(persisted.ok()).toBe(true);
      await expect(persisted.json()).resolves.toMatchObject({
        registration: true,
        supplierApplications: false,
      });
    } finally {
      const restored = await putWithCsrf(
        page,
        "/api/admin/settings/features",
        baseline,
      );
      expect(restored.ok()).toBe(true);
    }
  });

  test("renders the current server state in the admin settings UI", async ({
    page,
  }) => {
    await loginAs(page, fixtures.users.admin);
    const flagsResponse = await page.request.get(
      "/api/admin/settings/features",
    );
    const flags = await flagsResponse.json();

    await page.goto("/admin-settings");
    await expect(page.locator("#featureRegistration")).toBeEnabled();
    await expect(page.locator("#featureSupplierApply")).toBeEnabled();
    expect(await page.locator("#featureRegistration").isChecked()).toBe(
      flags.registration !== false,
    );
    expect(await page.locator("#featureSupplierApply").isChecked()).toBe(
      flags.supplierApplications !== false,
    );
    await expect(page.locator("#saveFeatureFlags")).toBeDisabled();
  });
});
