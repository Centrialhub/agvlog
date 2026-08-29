import { expect, test } from "@playwright/test";

import { accounts, fixtureIds } from "./fixtures/accounts";
import { loginThroughUi } from "./fixtures/session";

const internalRoutes = [
  "/", "/dashboard", "/vehicles", `/vehicles/${fixtureIds.vehicleA}`, "/drivers", "/fleet-map", "/alerts", "/geofences",
  "/reports", "/corridors", "/clients", "/orders", "/fiscal-documents", "/inventory",
  "/loads", `/loads/${fixtureIds.loadA}`, "/traceability", `/traceability/${fixtureIds.fiscalDocumentA}/pod`, "/load-extraction-audit",
  "/operations", "/operations-control", "/events", "/ingestion", "/ingestion-reports",
  "/productivity", "/settings", "/expense-approval", "/integration-health", "/team",
  "/data-audit", "/regions", "/freight", "/route-planning", "/receivables", "/financial",
  "/driver-settlements", "/cost-centers", "/bank-reconciliation", "/payables",
  "/client-invoices", "/billing-edi", "/operational-routes", "/employees", "/incidents",
  "/payroll", "/assets", "/maintenance-orders", "/stock", "/checklists", "/reallocation",
  "/billing", "/cte-monitor", "/cte-search", "/cte-hub", "/nfse", "/cte-consistency",
  "/pickup-orders", "/ort-management", "/product-traceability", "/product-history",
  "/mdfe-provisional", "/imported-notes-summary", "/load-control", "/closing-reports",
  "/rural-clients", "/driver-monitoring", "/occurrence-reports", `/occurrences/${fixtureIds.occurrenceA}/return-sheet`, "/pallet-returns",
  "/merchandise-shortages", "/routes",
] as const;

const driverRoutes = [
  "/driver", "/driver/loads", "/driver/stops", "/driver/deliveries", "/driver/issues",
  "/driver/journey", "/driver/expenses", "/driver/checklist", "/driver/events", `/driver/events/${fixtureIds.operationalEventA}`, "/driver/chat",
] as const;

const portalRoutes = [
  "/portal", "/portal/shipments", `/portal/shipments/${fixtureIds.fiscalDocumentA}`, "/portal/pickups", "/portal/documents", "/portal/pods",
  "/portal/occurrences", "/portal/tracking", "/portal/reports", "/portal/settings",
] as const;

async function smokeRoutes(page: Parameters<typeof loginThroughUi>[0], routes: readonly string[]) {
  for (const route of routes) {
    await test.step(route, async () => {
      const response = await page.goto(route);
      expect(response?.status() ?? 200).toBeLessThan(500);
      await expect(page.locator("body")).not.toContainText("Não foi possível abrir esta tela");
      await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 15_000 });
    });
  }
}

test("every registered internal route loads its production lazy chunk", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Full registry runs once; critical responsive routes have dedicated coverage.");
  test.setTimeout(300_000);
  await loginThroughUi(page, accounts.operator);
  await smokeRoutes(page, internalRoutes);
  await page.goto("/definitely-not-a-route");
  await expect(page.locator("body")).toContainText(/404|não encontrada/i);
});

test("every driver route loads for a driver fixture", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Dedicated critical driver tests cover tablet and mobile.");
  test.setTimeout(180_000);
  await loginThroughUi(page, accounts.driver);
  await smokeRoutes(page, driverRoutes);
});

test("every client portal route loads for a scoped client fixture", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Dedicated critical portal tests cover tablet and mobile.");
  test.setTimeout(180_000);
  await loginThroughUi(page, accounts.client);
  await smokeRoutes(page, portalRoutes);
});
