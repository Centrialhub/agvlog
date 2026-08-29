import { expect, test, type APIRequestContext } from "@playwright/test";

import { accounts, fixtureIds } from "./fixtures/accounts";
import { loginThroughUi, passwordToken } from "./fixtures/session";

type Session = Awaited<ReturnType<typeof passwordToken>>;

function apiHeaders(session: Session, prefer?: string) {
  return {
    apikey: session.publishableKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function rpc(
  request: APIRequestContext,
  session: Session,
  name: string,
  data: Record<string, unknown>,
) {
  return request.post(`${session.backendUrl}/rest/v1/rpc/${name}`, {
    headers: apiHeaders(session),
    data,
  });
}

test("operator creates a load and mutates composition/status only through audited RPCs", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Mutation contract runs once against the shared disposable database.");
  const session = await passwordToken(request, accounts.operator);
  const loadId = crypto.randomUUID();
  const loadNumber = `E2E-RPC-${loadId.slice(0, 8)}`;

  const created = await request.post(`${session.backendUrl}/rest/v1/loads`, {
    headers: apiHeaders(session, "return=representation"),
    data: {
      id: loadId,
      tenant_id: fixtureIds.tenantA,
      load_number: loadNumber,
      origin: "Montes Claros/MG",
      destination: "Janaúba/MG",
      status: "planned",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  try {
    const itemCreated = await rpc(request, session, "upsert_load_item_v3", {
      p_tenant_id: fixtureIds.tenantA,
      p_load_id: loadId,
      p_item_description: "Item de contrato E2E",
      p_quantity: 3,
      p_pallet_count: 2,
      p_weight_kg: 120,
      p_volume_m3: 1.5,
      p_status: "pending",
    });
    expect(itemCreated.ok(), await itemCreated.text()).toBeTruthy();
    const itemId = await itemCreated.json() as string;

    const recalculated = await request.get(
      `${session.backendUrl}/rest/v1/loads?id=eq.${loadId}&select=id,total_pallet_count,total_weight_kg,total_volume_m3,status`,
      { headers: apiHeaders(session) },
    );
    expect(recalculated.ok(), await recalculated.text()).toBeTruthy();
    const [load] = await recalculated.json() as Array<Record<string, unknown>>;
    expect(Number(load.total_pallet_count)).toBe(2);
    expect(Number(load.total_weight_kg)).toBe(120);
    expect(Number(load.total_volume_m3)).toBe(1.5);

    const invalid = await rpc(request, session, "transition_load_status_v1", {
      p_tenant_id: fixtureIds.tenantA,
      p_load_id: loadId,
      p_to_status: "delivered",
      p_reason: "must fail",
    });
    expect(invalid.ok()).toBeFalsy();
    expect(await invalid.text()).toContain("invalid_load_status_transition");

    const transitioned = await rpc(request, session, "transition_load_status_v1", {
      p_tenant_id: fixtureIds.tenantA,
      p_load_id: loadId,
      p_to_status: "assembling",
      p_reason: "E2E canonical transition",
    });
    expect(transitioned.ok(), await transitioned.text()).toBeTruthy();

    const history = await request.get(
      `${session.backendUrl}/rest/v1/load_status_history?load_id=eq.${loadId}&select=old_value,new_value,reason`,
      { headers: apiHeaders(session) },
    );
    expect(history.ok(), await history.text()).toBeTruthy();
    expect(await history.json()).toContainEqual({
      old_value: "planned",
      new_value: "assembling",
      reason: "E2E canonical transition",
    });

    const deleted = await rpc(request, session, "delete_load_item_v3", {
      p_tenant_id: fixtureIds.tenantA,
      p_item_id: itemId,
    });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
  } finally {
    await rpc(request, session, "delete_load_safely", {
      _tenant_id: fixtureIds.tenantA,
      _load_id: loadId,
    });
  }
});

test("driver completes the canonical trip, arrival, checklist, expense, occurrence and POD flow", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The lifecycle mutates one deterministic fixture; responsive rendering is covered independently.");
  const session = await passwordToken(request, accounts.driver);

  const started = await rpc(request, session, "driver_start_trip", { _trip_id: fixtureIds.tripA });
  expect(started.ok(), await started.text()).toBeTruthy();

  const arrived = await rpc(request, session, "driver_mark_arrival", { _stop_id: fixtureIds.stopA });
  expect(arrived.ok(), await arrived.text()).toBeTruthy();

  const checklist = await rpc(request, session, "driver_save_checklist", {
    _trip_id: fixtureIds.tripA,
    _kind: "pre",
    _payload: { tires: true, lights: true, source: "e2e" },
  });
  expect(checklist.ok(), await checklist.text()).toBeTruthy();

  const expense = await rpc(request, session, "driver_create_expense", {
    _trip_id: fixtureIds.tripA,
    _category: "toll",
    _amount: 12.5,
    _notes: "Despesa controlada E2E",
    _no_receipt: true,
    _no_receipt_reason: "Cenário automatizado sem comprovante",
    _payment_source: "driver",
  });
  expect(expense.ok(), await expense.text()).toBeTruthy();
  const expenseId = await expense.json() as string;

  const persistedExpense = await request.get(
    `${session.backendUrl}/rest/v1/driver_expenses?id=eq.${expenseId}&select=id,amount,approval_status,no_receipt,payment_source,reimbursable`,
    { headers: apiHeaders(session) },
  );
  expect(persistedExpense.ok(), await persistedExpense.text()).toBeTruthy();
  expect(await persistedExpense.json()).toEqual([
    expect.objectContaining({
      id: expenseId,
      amount: 12.5,
      approval_status: "pending",
      no_receipt: true,
      payment_source: "driver",
      reimbursable: true,
    }),
  ]);

  const occurrence = await rpc(request, session, "driver_create_event", {
    _trip_id: fixtureIds.tripA,
    _stop_id: fixtureIds.stopA,
    _event_type: "operational_note",
    _payload: { description: "Ocorrência controlada E2E" },
    _notes: "Sem impacto na entrega",
  });
  expect(occurrence.ok(), await occurrence.text()).toBeTruthy();

  const finalized = await rpc(request, session, "driver_finalize_delivery", {
    _stop_id: fixtureIds.stopA,
    _receiver_name: "Recebedor E2E",
    _receiver_document: "12345678900",
    _receiver_role: "Conferente",
    _photo_paths: [],
    _notes: "Entrega finalizada pelo contrato E2E",
  });
  expect(finalized.ok(), await finalized.text()).toBeTruthy();
  const result = await finalized.json() as { pod_ids?: string[] };
  expect(result.pod_ids?.length).toBeGreaterThan(0);

  const stop = await request.get(
    `${session.backendUrl}/rest/v1/dispatch_stops?id=eq.${fixtureIds.stopA}&select=status,actual_arrival_at,actual_departure_at`,
    { headers: apiHeaders(session) },
  );
  expect(stop.ok(), await stop.text()).toBeTruthy();
  expect(await stop.json()).toEqual([
    expect.objectContaining({ status: "delivered" }),
  ]);

  await loginThroughUi(page, accounts.driver);
  await page.goto("/driver/events");
  await page.reload();
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Algo deu errado");
});

test("@critical client portal APIs expose tenant A data and reject tenant B identifiers", async ({ request }) => {
  const session = await passwordToken(request, accounts.client);

  const summary = await rpc(request, session, "get_client_portal_summary_v2", {
    _tenant_id: fixtureIds.tenantA,
    _client_id: fixtureIds.clientA,
  });
  expect(summary.ok(), await summary.text()).toBeTruthy();
  expect(await summary.json()).toBeTruthy();

  const ownDocument = await request.get(
    `${session.backendUrl}/rest/v1/fiscal_documents?id=eq.${fixtureIds.fiscalDocumentA}&select=id,tenant_id,client_id`,
    { headers: apiHeaders(session) },
  );
  expect(ownDocument.ok(), await ownDocument.text()).toBeTruthy();
  expect(await ownDocument.json()).toEqual([
    expect.objectContaining({ id: fixtureIds.fiscalDocumentA, tenant_id: fixtureIds.tenantA }),
  ]);

  for (const [table, id] of [["clients", fixtureIds.clientB], ["loads", fixtureIds.loadB]] as const) {
    const denied = await request.get(
      `${session.backendUrl}/rest/v1/${table}?id=eq.${id}&select=id,tenant_id`,
      { headers: apiHeaders(session) },
    );
    expect(denied.ok(), await denied.text()).toBeTruthy();
    expect(await denied.json()).toEqual([]);
  }
});

test("driver load failures render an actionable retry instead of an empty list", async ({ page }) => {
  await loginThroughUi(page, accounts.driver);
  await page.route("**/rest/v1/loads?*", (route) => route.abort("failed"));
  await page.goto("/driver/loads");

  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar suas cargas", { timeout: 20_000 });
  await expect(page.getByText("Nenhuma carga encontrada")).toHaveCount(0);

  await page.unroute("**/rest/v1/loads?*");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Carga E2E-LOAD-A-001")).toBeVisible({ timeout: 20_000 });
});

test("client registry paginates on the server and persists debounced search", async ({ page }) => {
  await loginThroughUi(page, accounts.operator);
  await page.goto("/clients");

  await expect(page.getByText("Exibindo 1–50 de 126")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("Cliente Massa A 050")).toBeVisible();

  await page.getByPlaceholder(/Buscar por nome/).fill("Massa A 125");
  await expect(page).toHaveURL(/q=Massa(?:\+|%20)A(?:\+|%20)125/, { timeout: 5_000 });
  await expect(page.getByText("Cliente Massa A 125")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Exibindo 1–1 de 1")).toBeVisible();

  await page.reload();
  await expect(page.getByPlaceholder(/Buscar por nome/)).toHaveValue("Massa A 125");
  await expect(page.getByText("Cliente Massa A 125")).toBeVisible({ timeout: 20_000 });
});

test("load registry filters before server pagination and restores its URL state", async ({ page }) => {
  await loginThroughUi(page, accounts.operator);
  await page.goto("/loads");

  await expect(page.getByText(/Mostrando 1–25 de \d+/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Próxima página" })).toBeEnabled();

  await page.getByPlaceholder("Buscar carga, placa ou destino...").fill("E2E-BULK-A-125");
  await expect(page).toHaveURL(/q=E2E-BULK-A-125/, { timeout: 5_000 });
  await expect(page.getByRole("button", { name: "E2E-BULK-A-125", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Mostrando 1–1 de 1")).toBeVisible();

  await page.reload();
  await expect(page.getByPlaceholder("Buscar carga, placa ou destino...")).toHaveValue("E2E-BULK-A-125");
  await expect(page.getByRole("button", { name: "E2E-BULK-A-125", exact: true })).toBeVisible({ timeout: 20_000 });
});

test("client portal reports an RPC failure and retries instead of showing zero KPIs", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_client_portal_summary_v2", route => route.abort("failed"));
  await loginThroughUi(page, accounts.client);
  await page.goto("/portal");

  await expect(page.getByText(/Erro ao carregar os indicadores/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Em trânsito")).toHaveCount(0);

  await page.unroute("**/rest/v1/rpc/get_client_portal_summary_v2");
  await page.getByRole("button", { name: "Tentar novamente" }).first().click();
  await expect(page.getByText("Em trânsito")).toBeVisible({ timeout: 20_000 });
});
