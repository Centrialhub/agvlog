import { expect, test } from "@playwright/test";
import { accounts, fixtureIds } from "./fixtures/accounts";
import { passwordToken } from "./fixtures/session";

test("@critical private Storage serves real bytes only to the matching tenant", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Physical object contract runs once per repeat on the shared local service.");
  const own = await passwordToken(request, accounts.operator);
  const other = await passwordToken(request, accounts.tenantB);
  expect(new URL(own.backendUrl).hostname).toBe("127.0.0.1");
  const serviceKey = process.env.E2E_LOCAL_STORAGE_SERVICE_KEY;
  if (!serviceKey) throw new Error("Local guarded wrapper must supply the temporary Storage fixture service key.");
  const objectPath = `${fixtureIds.tenantA}/qa-stability/${crypto.randomUUID()}.pdf`;
  // A physical, nonfinancial fixture; never fabricate receipt metadata in SQL.
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  const fixtureHeaders = { apikey: own.publishableKey, Authorization: `Bearer ${serviceKey}` };
  const userHeaders = (session: typeof own, tenant: string) => ({
    apikey: session.publishableKey, Authorization: `Bearer ${session.accessToken}`,
    "x-agvlog-tenant-id": tenant,
  });
  let uploaded = false;
  try {
    const upload = await request.post(`${own.backendUrl}/storage/v1/object/receipts/${objectPath}`, {
      headers: { ...fixtureHeaders, "Content-Type": "application/pdf", "x-upsert": "false" }, data: bytes,
    });
    expect(upload.ok(), "Local service fixture upload must succeed without changing any ACL").toBeTruthy();
    uploaded = true;
    const read = await request.get(`${own.backendUrl}/storage/v1/object/authenticated/receipts/${objectPath}`, {
      headers: userHeaders(own, fixtureIds.tenantA),
    });
    expect(read.ok()).toBeTruthy();
    expect(await read.body()).toEqual(bytes);
    const crossTenant = await request.get(`${own.backendUrl}/storage/v1/object/authenticated/receipts/${objectPath}`, {
      headers: userHeaders(other, fixtureIds.tenantB),
    });
    expect(crossTenant.ok()).toBeFalsy();
    expect([400, 403, 404]).toContain(crossTenant.status());
    const anonymous = await request.get(`${own.backendUrl}/storage/v1/object/receipts/${objectPath}`, {
      headers: { apikey: own.publishableKey },
    });
    expect(anonymous.ok()).toBeFalsy();
    expect([400, 401, 403, 404]).toContain(anonymous.status());
  } finally {
    if (uploaded) {
      const removed = await request.delete(`${own.backendUrl}/storage/v1/object/receipts`, {
        headers: { ...fixtureHeaders, "Content-Type": "application/json" }, data: { prefixes: [objectPath] },
      });
      expect(removed.ok(), "Physical fixture cleanup must succeed").toBeTruthy();
      const absent = await request.get(`${own.backendUrl}/storage/v1/object/authenticated/receipts/${objectPath}`, {
        headers: fixtureHeaders,
      });
      expect(absent.ok()).toBeFalsy();
      expect([400, 404]).toContain(absent.status());
    }
  }
});
