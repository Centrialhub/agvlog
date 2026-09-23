// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createFinanceAuditDatabase } from "./helpers/financeAuditRemediationDatabase";
import { financeIds as i } from "./helpers/financeLedgerDatabase";
let db: Awaited<ReturnType<typeof createFinanceAuditDatabase>>;
beforeAll(async () => {
  db = await createFinanceAuditDatabase();
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: i.operator,
      role: "authenticated",
      active_tenant_id: i.tenant,
    }),
  ]);
  await db.query("insert into tenants(id) values($1)", [i.tenant]);
  await db.query(
    "insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)",
    [i.tenant, i.operator],
  );
});
afterEach(async () => {
  await db.exec("rollback");
});
async function call(sql: string, args: unknown[]) {
  await db.exec("savepoint command");
  try {
    const result = (await db.query<{ v: Record<string, unknown> }>(sql, args))
      .rows[0].v;
    await db.exec("release savepoint command");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint command;release savepoint command");
    throw error;
  }
}
const read = () => call("select get_finance_approval_policy($1) v", [i.tenant]);
const issue = (amount: number, creator: string = randomUUID()) =>
  call("select to_jsonb(finance_private.approval_limit_issue($1,$2)) v", [
    i.tenant,
    { amount, created_by: creator },
  ]);
it("preserves the default rule and enforces configured limits and separation with durable replay", async () => {
  const before = await read();
  expect(before.policy).toMatchObject({ enabled: false });
  expect(await issue(1000000, i.operator)).toBeNull();
  const command = {
    version: 1,
    tenant_id: i.tenant,
    request_id: randomUUID(),
    revision: before.revision,
    enabled: true,
    operator_limit_cents: "10000",
    admin_limit_cents: "50000",
    prevent_self_approval: true,
    reason: "Alçadas aprovadas pela empresa",
  };
  const save = () =>
    call("select save_finance_approval_policy($1) v", [command]);
  const first = await save();
  expect(await save()).toEqual(first);
  expect(await issue(500)).toBeNull();
  expect(await issue(500.01)).toBe("finance_approval_limit_exceeded");
  expect(await issue(100, i.operator)).toBe("finance_approval_preparer");
  await db.exec("update tenant_memberships set role='operator'");
  expect(await issue(100.01)).toBe("finance_approval_limit_exceeded");
  await expect(save()).rejects.toThrow("finance_access_denied");
  await db.exec("update tenant_memberships set role='owner'");
  expect(await issue(1000000)).toBeNull();
  expect(await issue(1, i.operator)).toBe("finance_approval_preparer");
  await expect(
    call("select save_finance_approval_policy($1) v", [
      { ...command, request_id: randomUUID() },
    ]),
  ).rejects.toThrow("finance_approval_policy_changed");
});
it("enforces configured limits even through direct updates", async () => {
  const before = await read();
  await call("select save_finance_approval_policy($1) v", [
    {
      version: 1,
      tenant_id: i.tenant,
      request_id: randomUUID(),
      revision: before.revision,
      enabled: true,
      operator_limit_cents: null,
      admin_limit_cents: "100",
      prevent_self_approval: false,
      reason: "Limite para teste isolado",
    },
  ]);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,status,source) values($1,$2,2,'pending','manual')",
    [id, i.tenant],
  );
  await expect(
    call(
      "with changed as(update payables set status='approved' where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id],
    ),
  ).rejects.toThrow("finance_approval_limit_exceeded");
  expect(
    (await db.query("select status from payables where id=$1", [id])).rows[0],
  ).toEqual({ status: "pending" });
});
it("keeps the existing approval command working with the unchanged default policy", async () => {
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,supplier_name) values($1,$2,100,0,'pending','manual','Fornecedor QA')",
    [id, i.tenant],
  );
  const preview = await call(
    "select preview_finance_payable_approval($1,$2) v",
    [i.tenant, id],
  );
  const command = {
    version: 1,
    tenant_id: i.tenant,
    request_id: randomUUID(),
    payable_id: id,
    revision: preview.revision,
    amount_cents: "10000",
    reason: "Obrigação conferida para aprovação",
  };
  const first = await call("select approve_finance_payable($1) v", [command]);
  expect(first).toMatchObject({
    confirmed: true,
    status: "approved",
    cash_changed: false,
  });
  expect(await call("select approve_finance_payable($1) v", [command])).toEqual(
    first,
  );
});
it("checks the final amount when approval and amount change in the same update", async () => {
  const before = await read();
  await call("select save_finance_approval_policy($1) v", [
    {
      version: 1,
      tenant_id: i.tenant,
      request_id: randomUUID(),
      revision: before.revision,
      enabled: true,
      operator_limit_cents: "100",
      admin_limit_cents: "100",
      prevent_self_approval: false,
      reason: "Limite para teste de alteração",
    },
  ]);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,supplier_name) values($1,$2,1,0,'pending','manual','Fornecedor QA')",
    [id, i.tenant],
  );
  await expect(
    call(
      "with changed as(update payables set amount=1000,status='approved' where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id],
    ),
  ).rejects.toThrow("finance_approval_limit_exceeded");
});
it("requires a new review before increasing an already approved amount under an active policy", async () => {
  const before = await read();
  await call("select save_finance_approval_policy($1) v", [
    {
      version: 1,
      tenant_id: i.tenant,
      request_id: randomUUID(),
      revision: before.revision,
      enabled: true,
      operator_limit_cents: "100",
      admin_limit_cents: "100",
      prevent_self_approval: false,
      reason: "Limite para teste de alteração",
    },
  ]);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,supplier_name) values($1,$2,1,0,'approved','manual','Fornecedor QA')",
    [id, i.tenant],
  );
  await expect(
    call(
      "with changed as(update payables set amount=1000 where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id],
    ),
  ).rejects.toThrow("finance_approval_requires_review");
});

async function policy(enabled = true, separate = false) {
  const before = await read();
  await call("select save_finance_approval_policy($1) v", [
    {
      version: 1,
      tenant_id: i.tenant,
      request_id: randomUUID(),
      revision: before.revision,
      enabled,
      operator_limit_cents: "10000",
      admin_limit_cents: "10000",
      prevent_self_approval: separate,
      reason: "Política para teste de regressão",
    },
  ]);
}
it("preserves the unchanged rule while optional limits are disabled", async () => {
  await policy(false, true);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source) values($1,$2,1,0,'approved','manual')",
    [id, i.tenant],
  );
  await call(
    "with changed as(update payables set amount=1000 where id=$1 returning amount) select to_jsonb(changed) v from changed",
    [id],
  );
  expect(
    (await db.query("select amount from payables where id=$1", [id])).rows[0],
  ).toMatchObject({ amount: "1000.00" });
});
it("requires review for a beneficiary change and permits saving a pending revision", async () => {
  await policy();
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,supplier_name) values($1,$2,1,0,'approved','manual','Fornecedor A')",
    [id, i.tenant],
  );
  await expect(
    call(
      "with changed as(update payables set supplier_name='Fornecedor B' where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id],
    ),
  ).rejects.toThrow("finance_approval_requires_review");
  await call(
    "with changed as(update payables set amount=2,status='pending' where id=$1 returning id) select to_jsonb(changed) v from changed",
    [id],
  );
  const preview = await call(
    "select preview_finance_payable_approval($1,$2) v",
    [i.tenant, id],
  );
  const result = await call("select approve_finance_payable($1) v", [
    {
      version: 1,
      tenant_id: i.tenant,
      request_id: randomUUID(),
      payable_id: id,
      revision: preview.revision,
      amount_cents: "200",
      reason: "Conferência após alteração da obrigação",
    },
  ]);
  expect(result).toMatchObject({
    confirmed: true,
    status: "approved",
    cash_changed: false,
  });
  await call(
    "with changed as(update payables set notes='Conferido' where id=$1 returning id) select to_jsonb(changed) v from changed",
    [id],
  );
});
it("uses the original preparer and refuses forged identities when approving", async () => {
  await policy(true, true);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,created_by) values($1,$2,1,0,'pending','manual',$3)",
    [id, i.tenant, i.operator],
  );
  await expect(
    call(
      "with changed as(update payables set status='approved',created_by=$2,updated_by=$2 where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id, randomUUID()],
    ),
  ).rejects.toThrow("finance_approval_preparer");
  await expect(
    call(
      "with changed as(insert into payables(id,tenant_id,amount,paid_amount,status,source,created_by) values($1,$2,1,0,'approved','manual',$3) returning id) select to_jsonb(changed) v from changed",
      [randomUUID(), i.tenant, randomUUID()],
    ),
  ).rejects.toThrow("finance_approval_preparer");
});
it("allows a different approver within the configured limit through the approval command", async () => {
  await policy(true, true);
  const id = randomUUID(),
    preparer = randomUUID();
  await db.query(
    "insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)",
    [i.tenant, preparer],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: preparer,
      role: "authenticated",
      active_tenant_id: i.tenant,
    }),
  ]);
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,created_by) values($1,$2,100,0,'pending','manual',$3)",
    [id, i.tenant, preparer],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: i.operator,
      role: "authenticated",
      active_tenant_id: i.tenant,
    }),
  ]);
  const preview = await call(
    "select preview_finance_payable_approval($1,$2) v",
    [i.tenant, id],
  );
  expect(preview).toMatchObject({ eligible: true });
  const result = await call("select approve_finance_payable($1) v", [
    {
      version: 1,
      tenant_id: i.tenant,
      request_id: randomUUID(),
      payable_id: id,
      revision: preview.revision,
      amount_cents: "10000",
      reason: "Conferência por aprovador independente",
    },
  ]);
  expect(result).toMatchObject({ confirmed: true, status: "approved" });
});

it("does not allow replacing preparation identities in a separate write before approval", async () => {
  await policy(true, true);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,created_by) values($1,$2,1,0,'pending','manual',$3)",
    [id, i.tenant, i.operator],
  );
  await call(
    "with changed as(update payables set created_by=$2,updated_by=$2 where id=$1 returning id) select to_jsonb(changed) v from changed",
    [id, randomUUID()],
  );
  await expect(
    call(
      "with changed as(update payables set status='approved' where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id],
    ),
  ).rejects.toThrow("finance_approval_preparer");
});

it("stamps the authenticated creator instead of a supplied identity", async () => {
  await policy(true, true);
  const id = randomUUID();
  await db.query(
    "insert into payables(id,tenant_id,amount,paid_amount,status,source,created_by) values($1,$2,1,0,'pending','manual',$3)",
    [id, i.tenant, randomUUID()],
  );
  expect(
    (await db.query("select created_by from payables where id=$1", [id]))
      .rows[0],
  ).toEqual({ created_by: i.operator });
  await expect(
    call(
      "with changed as(update payables set status='approved' where id=$1 returning id) select to_jsonb(changed) v from changed",
      [id],
    ),
  ).rejects.toThrow("finance_approval_preparer");
});
