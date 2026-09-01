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

test("driver records canonical expense and delivery outcome with recoverable event chat", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The lifecycle mutates the shared disposable fixture; responsive rendering is covered independently.");
  const ownerSession = await passwordToken(request, accounts.owner);
  const operatorSession = await passwordToken(request, accounts.operator);
  const clientSession = await passwordToken(request, accounts.client);
  const session = await passwordToken(request, accounts.driver);
  const deliveryStopId = crypto.randomUUID();

  // The seeded fiscal document is already terminal and has a validated POD. A
  // document-free stop exercises the delivery contract without fiscal writes.
  const stopCreated = await request.post(`${ownerSession.backendUrl}/rest/v1/dispatch_stops`, {
    headers: apiHeaders(ownerSession, "return=representation"),
    data: {
      id: deliveryStopId,
      tenant_id: fixtureIds.tenantA,
      dispatch_trip_id: fixtureIds.tripA,
      stop_order: 1_000 + Number.parseInt(deliveryStopId.slice(0, 4), 16),
      destination: "Parada operacional E2E sem documentos",
      status: "pending",
      latitude: -15.802,
      longitude: -43.313,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
  expect(stopCreated.ok(), await stopCreated.text()).toBeTruthy();

  const started = await rpc(request, session, "driver_start_trip", { _trip_id: fixtureIds.tripA });
  expect(started.ok(), await started.text()).toBeTruthy();

  const arrived = await rpc(request, session, "driver_mark_arrival", {
    _stop_id: deliveryStopId,
    _latitude: -15.802,
    _longitude: -43.313,
    _accuracy_m: 10,
  });
  expect(arrived.ok(), await arrived.text()).toBeTruthy();

  const checklist = await rpc(request, session, "driver_save_checklist", {
    _trip_id: fixtureIds.tripA,
    _kind: "pre",
    _payload: { tires: true, lights: true, source: "e2e" },
  });
  expect(checklist.ok(), await checklist.text()).toBeTruthy();

  const expenseContextResponse = await rpc(request, session, "get_expense_creation_context", {
    _tenant_id: fixtureIds.tenantA,
    _source_type: "trip",
    _source_id: fixtureIds.tripA,
  });
  expect(expenseContextResponse.ok(), await expenseContextResponse.text()).toBeTruthy();
  const expenseContext = await expenseContextResponse.json() as {
    actor_id: string;
    can_create: boolean;
    revision: string;
  };
  expect(expenseContext.can_create).toBe(true);

  const expensePayload = {
    version: 1,
    tenant_id: fixtureIds.tenantA,
    actor_id: expenseContext.actor_id,
    request_id: crypto.randomUUID(),
    source_type: "trip",
    source_id: fixtureIds.tripA,
    expected_revision: expenseContext.revision,
    fields: {
      category: "toll",
      amount_cents: 1250,
      expense_at: new Date().toISOString(),
      payment_source: "driver",
      reimbursable: true,
      no_receipt: true,
      no_receipt_reason: "Cenário automatizado sem comprovante",
      notes: "Despesa controlada E2E",
    },
    receipt: null,
  };
  const expense = await rpc(request, session, "create_driver_expense_command", {
    _payload: expensePayload,
  });
  expect(expense.ok(), await expense.text()).toBeTruthy();
  const expenseResult = await expense.json() as {
    confirmed: boolean;
    expense_id: string;
    request_id: string;
    status: string;
  };
  expect(expenseResult).toMatchObject({
    confirmed: true,
    request_id: expensePayload.request_id,
    status: "pending",
  });
  const expenseId = expenseResult.expense_id;

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

  const deliveryEventId = crypto.randomUUID();
  const deliveryDetails = {
    notes: "Cliente indisponível no cenário E2E",
    event_label: "Cliente ausente E2E",
    photo_paths: [],
    signature_path: null,
    returned_items: {},
  };
  const delivery = await rpc(request, session, "driver_record_delivery_outcome", {
    _stop_id: deliveryStopId,
    _outcome: "failed",
    _details: deliveryDetails,
    _client_event_id: deliveryEventId,
    _expected_status: "arrived",
  });
  expect(delivery.ok(), await delivery.text()).toBeTruthy();
  const deliveryResult = await delivery.json() as {
    event_id: string;
    operational_event_id: string;
    pod_ids: string[];
    replayed: boolean;
    updated_document_ids: string[];
    updated_stop_id: string;
  };
  expect(deliveryResult).toMatchObject({
    pod_ids: [],
    replayed: false,
    updated_document_ids: [],
    updated_stop_id: deliveryStopId,
  });

  const replayedDelivery = await rpc(request, session, "driver_record_delivery_outcome", {
    _stop_id: deliveryStopId,
    _outcome: "failed",
    _details: deliveryDetails,
    _client_event_id: deliveryEventId,
    _expected_status: "arrived",
  });
  expect(replayedDelivery.ok(), await replayedDelivery.text()).toBeTruthy();
  expect(await replayedDelivery.json()).toEqual({ ...deliveryResult, replayed: true });

  const stop = await request.get(
    `${session.backendUrl}/rest/v1/dispatch_stops?id=eq.${deliveryStopId}&select=status,actual_arrival_at,actual_departure_at`,
    { headers: apiHeaders(session) },
  );
  expect(stop.ok(), await stop.text()).toBeTruthy();
  expect(await stop.json()).toEqual([
    expect.objectContaining({ status: "failed" }),
  ]);

  const operationEvent = await request.get(
    `${operatorSession.backendUrl}/rest/v1/operational_events?id=eq.${deliveryResult.operational_event_id}&select=id,dispatch_stop_id,event_type,visible_to_client,report_details`,
    { headers: apiHeaders(operatorSession) },
  );
  expect(operationEvent.ok(), await operationEvent.text()).toBeTruthy();
  expect(await operationEvent.json()).toEqual([
    expect.objectContaining({
      id: deliveryResult.operational_event_id,
      dispatch_stop_id: deliveryStopId,
      event_type: "failed",
      visible_to_client: false,
      report_details: expect.objectContaining({ label: "Cliente ausente E2E" }),
    }),
  ]);

  const hiddenFromPortal = await request.get(
    `${clientSession.backendUrl}/rest/v1/operational_events?id=eq.${deliveryResult.operational_event_id}&select=id`,
    { headers: apiHeaders(clientSession) },
  );
  expect(hiddenFromPortal.ok(), await hiddenFromPortal.text()).toBeTruthy();
  expect(await hiddenFromPortal.json()).toEqual([]);

  const driverChatContextResponse = await rpc(request, session, "get_event_chat_context", {
    _tenant_id: fixtureIds.tenantA,
    _event_id: deliveryResult.operational_event_id,
  });
  expect(driverChatContextResponse.ok(), await driverChatContextResponse.text()).toBeTruthy();
  const driverChatContext = await driverChatContextResponse.json() as {
    actor_id: string;
    can_send: boolean;
    driver_id: string;
    revision: string;
  };
  expect(driverChatContext.can_send).toBe(true);
  const driverMessagePayload = {
    version: 1,
    tenant_id: fixtureIds.tenantA,
    actor_id: driverChatContext.actor_id,
    driver_id: driverChatContext.driver_id,
    event_id: deliveryResult.operational_event_id,
    request_id: crypto.randomUUID(),
    expected_revision: driverChatContext.revision,
    message: "Motorista aguardando orientação da operação.",
  };
  const driverMessage = await rpc(request, session, "send_event_chat_message", {
    _payload: driverMessagePayload,
  });
  expect(driverMessage.ok(), await driverMessage.text()).toBeTruthy();
  const driverMessageResult = await driverMessage.json();
  expect(driverMessageResult).toMatchObject({
    confirmed: true,
    request_id: driverMessagePayload.request_id,
  });

  const replayedMessage = await rpc(request, session, "send_event_chat_message", {
    _payload: driverMessagePayload,
  });
  expect(replayedMessage.ok(), await replayedMessage.text()).toBeTruthy();
  expect(await replayedMessage.json()).toEqual(driverMessageResult);

  const operatorChatContextResponse = await rpc(request, operatorSession, "get_event_chat_context", {
    _tenant_id: fixtureIds.tenantA,
    _event_id: deliveryResult.operational_event_id,
  });
  expect(operatorChatContextResponse.ok(), await operatorChatContextResponse.text()).toBeTruthy();
  const operatorChatContext = await operatorChatContextResponse.json() as {
    actor_id: string;
    can_send: boolean;
    driver_id: string;
    revision: string;
  };
  expect(operatorChatContext.can_send).toBe(true);
  const operatorMessage = await rpc(request, operatorSession, "send_event_chat_message", {
    _payload: {
      version: 1,
      tenant_id: fixtureIds.tenantA,
      actor_id: operatorChatContext.actor_id,
      driver_id: operatorChatContext.driver_id,
      event_id: deliveryResult.operational_event_id,
      request_id: crypto.randomUUID(),
      expected_revision: operatorChatContext.revision,
      message: "Operação confirmou o recebimento da ocorrência.",
    },
  });
  expect(operatorMessage.ok(), await operatorMessage.text()).toBeTruthy();

  const messages = await rpc(request, session, "list_event_chat_messages", {
    _tenant_id: fixtureIds.tenantA,
    _event_id: deliveryResult.operational_event_id,
    _before: null,
  });
  expect(messages.ok(), await messages.text()).toBeTruthy();
  expect(await messages.json()).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({ message: driverMessagePayload.message, sender_role: "driver" }),
      expect.objectContaining({ message: "Operação confirmou o recebimento da ocorrência.", sender_role: "operator" }),
    ]),
  });

  await loginThroughUi(page, accounts.driver);
  await page.goto("/driver/events");
  await page.reload();
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
  await expect(page.getByText("Cliente ausente E2E")).toBeVisible({ timeout: 20_000 });
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
