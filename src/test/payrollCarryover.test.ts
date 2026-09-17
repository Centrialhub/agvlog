// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createPayrollRecordedAdvanceDatabase } from './helpers/payrollRecordedAdvanceDatabase';
import { financeAs, financeIds as ids } from './helpers/financeLedgerDatabase';

let db: PGlite;
beforeAll(async () => {
  db = await createPayrollRecordedAdvanceDatabase();
  await db.exec(readFileSync('supabase/migrations/20260914215302_finance_payroll_carryover_propagation.sql', 'utf8'));
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.operator]);
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2", [ids.tenant, ids.operator]);
});
afterEach(async () => { await db.exec('rollback'); });

const command = () => ({
  version: 1,
  tenant_id: ids.tenant,
  request_id: randomUUID(),
  reason: 'Carryover payroll proof under test',
});
async function employee(name: string, salary: number | null) {
  const id = randomUUID();
  await db.query('insert into employees(id,tenant_id,name) values($1,$2,$3)', [id, ids.tenant, name]);
  if (salary !== null) {
    await db.query("insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values($1,$2,'fixed','2026-01-01',$3)", [ids.tenant, id, salary]);
  }
  return id;
}
async function paidAdvance(employeeId: string, employeeName: string, nominal: number, paidCents: number) {
  const advance = (await financeAs<{ id: string }>(
    db,
    ids.operator,
    "select register_employee_advance($1,$2,$3,'2026-08-15','Carryover advance','pix',null,true,false) id",
    [ids.tenant, employeeId, nominal],
  )).rows[0].id;
  const payable = (await db.query<{ payable_id: string }>('select payable_id from employee_advances where id=$1', [advance])).rows[0].payable_id;
  await db.query("update payables set status='approved' where id=$1", [payable]);
  const movement = (await financeAs<{ value: { movement_id: string } }>(
    db,
    ids.operator,
    'select record_finance_movement($1) value',
    [{
      ...command(),
      bank_account_id: ids.account,
      direction: 'out',
      nature: 'payment',
      amount_cents: paidCents,
      occurred_on: '2026-08-15',
      description: 'Actual delivered employee advance',
      beneficiary_name: employeeName,
    }],
  )).rows[0].value.movement_id;
  await financeAs(db, ids.operator, 'select apply_finance_payable_movement($1)', [{
    ...command(),
    movement_id: movement,
    payable_id: payable,
    amount_cents: paidCents,
    method: 'pix',
  }]);
  return { advance, payable, movement };
}
async function generate(start: string, end: string) {
  return (await financeAs<{ id: string }>(
    db,
    ids.operator,
    'select generate_payroll_period($1,$2,$3) id',
    [ids.tenant, start, end],
  )).rows[0].id;
}
async function entry(period: string, employeeId: string) {
  return (await db.query<{
    id: string;
    gross_amount: string;
    already_paid_amount: string;
    amount_to_pay: string;
    carryover_amount: string;
    source_summary: Record<string, unknown>;
  }>('select id,gross_amount,already_paid_amount,amount_to_pay,carryover_amount,source_summary from payroll_entries where payroll_period_id=$1 and employee_id=$2', [period, employeeId])).rows[0];
}

it('carries only the proven excess once into the next contiguous competence with an audited source chain', async () => {
  const employeeId = await employee('Carryover employee', 100);
  const otherEmployee = await employee('Employee without carryover', 100);
  await paidAdvance(employeeId, 'Carryover employee', 200, 12_000);
  const august = await generate('2026-08-01', '2026-08-31');
  const augustEntry = await entry(august, employeeId);
  expect(Number(augustEntry.gross_amount)).toBe(100);
  expect(Number(augustEntry.already_paid_amount)).toBe(120);
  expect(Number(augustEntry.amount_to_pay)).toBe(0);
  expect(Number(augustEntry.carryover_amount)).toBe(20);
  await financeAs(db, ids.operator, 'select approve_payroll_period($1)', [august]);

  const september = await generate('2026-09-01', '2026-09-30');
  const septemberEntry = await entry(september, employeeId);
  expect(Number(septemberEntry.gross_amount)).toBe(100);
  expect(Number(septemberEntry.already_paid_amount)).toBe(20);
  expect(Number(septemberEntry.amount_to_pay)).toBe(80);
  expect(Number(septemberEntry.carryover_amount)).toBe(0);
  expect(septemberEntry.source_summary).toMatchObject({
    payroll_carryover: {
      source_entry: { id: augustEntry.id, tenant_id: ids.tenant, employee_id: employeeId },
      amount_cents: '2000',
      paid_cents: '12000',
      valid: true,
    },
  });
  const item = (await db.query<{
    id: string;
    tenant_id: string;
    employee_id: string;
    source_id: string;
    amount: string;
    source_metadata: { payroll_carryover: { amount_cents: string } };
  }>("select id,tenant_id,employee_id,source_id,amount,source_metadata from payroll_entry_items where payroll_entry_id=$1 and source_table='payroll_entries'", [septemberEntry.id])).rows[0];
  expect(item).toMatchObject({
    tenant_id: ids.tenant,
    employee_id: employeeId,
    source_id: augustEntry.id,
    source_metadata: { payroll_carryover: { amount_cents: '2000' } },
  });
  expect(Number(item.amount)).toBe(20);
  const chain = (await db.query<{ value: { valid: boolean; footprints: unknown[] } }>(
    "select finance_private.paid_projection_chain($1,'payroll_entry_items',$2) value",
    [ids.tenant, item.id],
  )).rows[0].value;
  expect(chain).toMatchObject({ valid: true, footprints: expect.any(Array) });
  expect(chain.footprints.length).toBeGreaterThan(0);
  const storedProof = (septemberEntry.source_summary.payroll_carryover as { revision: string; footprints: unknown[] });
  expect(storedProof.revision).toMatch(/^[0-9a-f]{32}$/);
  expect(storedProof.footprints.length).toBeGreaterThan(0);
  expect((await db.query<{ n: number }>(
    "select count(*)::int n from payroll_entry_items where payroll_entry_id=(select id from payroll_entries where payroll_period_id=$1 and employee_id=$2) and source_table='payroll_entries'",
    [september, otherEmployee],
  )).rows[0].n).toBe(0);
  await db.exec('savepoint cross_tenant');
  await expect(db.query('select finance_private.payroll_carryover_context($1,$2)', [ids.otherTenant, septemberEntry.id]))
    .rejects.toThrow('finance_payroll_entry_not_found');
  await db.exec('rollback to savepoint cross_tenant');

  expect(await generate('2026-09-01', '2026-09-30')).toBe(september);
  expect((await db.query<{ n: number }>("select count(*)::int n from payroll_entry_items where payroll_entry_id=$1 and source_table='payroll_entries'", [septemberEntry.id])).rows[0].n).toBe(1);
  const auditEvents = (await db.query<{ after_data: { cash_changed: boolean; fiscal_document_created: boolean } }>(
    "select after_data from finance_events where tenant_id=$1 and entity_id=$2 and action='payroll_carryover_propagated'",
    [ids.tenant, septemberEntry.id],
  )).rows;
  expect(auditEvents).toHaveLength(1);
  expect(auditEvents[0].after_data).toMatchObject({ cash_changed: false, fiscal_document_created: false });

  await financeAs(db, ids.operator, 'select approve_payroll_period($1)', [september]);
  await db.exec('savepoint protected');
  await expect(financeAs(db, ids.operator, 'select recalculate_payroll_entry($1)', [septemberEntry.id]))
    .rejects.toThrow('finance_payroll_period_protected');
  await db.exec('rollback to savepoint protected');
  await db.exec('savepoint protected_item');
  await expect(db.query("update payroll_entry_items set amount=21 where id=$1", [item.id]))
    .rejects.toThrow(/approved|protegido|protected/);
  await db.exec('rollback to savepoint protected_item');
});

it('rejects approval with a newly materialized predecessor until the target entry is explicitly recalculated', async () => {
  const employeeId = await employee('Stale carryover employee', 100);
  await paidAdvance(employeeId, 'Stale carryover employee', 200, 12_000);
  const august = await generate('2026-08-01', '2026-08-31');
  const augustEntry = await entry(august, employeeId);
  const september = await generate('2026-09-01', '2026-09-30');
  const septemberEntry = await entry(september, employeeId);
  expect(Number(septemberEntry.already_paid_amount)).toBe(0);
  await financeAs(db, ids.operator, 'select approve_payroll_period($1)', [august]);

  await db.exec('savepoint stale');
  await expect(financeAs(db, ids.operator, 'select approve_payroll_period($1)', [september]))
    .rejects.toMatchObject({ code: '40001' });
  await db.exec('rollback to savepoint stale');
  await financeAs(db, ids.operator, 'select recalculate_payroll_entry($1)', [septemberEntry.id]);
  expect(Number((await entry(september, employeeId)).already_paid_amount)).toBe(20);
  expect(Number((await entry(september, employeeId)).amount_to_pay)).toBe(80);
  await financeAs(db, ids.operator, 'select approve_payroll_period($1)', [september]);
  expect((await db.query<{ source_id: string }>("select source_id from payroll_entry_items where payroll_entry_id=$1 and source_table='payroll_entries'", [septemberEntry.id])).rows[0].source_id).toBe(augustEntry.id);
});

it('does not manufacture carryover from a negative net when no payment was delivered', async () => {
  const employeeId = await employee('No phantom carryover', null);
  const august = await generate('2026-08-01', '2026-08-31');
  const augustEntry = await entry(august, employeeId);
  await db.query("insert into payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount,created_by) values($1,$2,$3,$4,'manual_debit','debit','Manual debit without prior payment',100,$5)", [
    ids.tenant,
    august,
    augustEntry.id,
    employeeId,
    ids.operator,
  ]);
  await financeAs(db, ids.operator, 'select recalculate_payroll_entry($1)', [augustEntry.id]);
  const recalculated = await entry(august, employeeId);
  expect(Number(recalculated.gross_amount)).toBe(0);
  expect(Number(recalculated.already_paid_amount)).toBe(0);
  expect(Number(recalculated.amount_to_pay)).toBe(0);
  expect(Number(recalculated.carryover_amount)).toBe(0);
  await financeAs(db, ids.operator, 'select approve_payroll_period($1)', [august]);
  const september = await generate('2026-09-01', '2026-09-30');
  const septemberEntry = await entry(september, employeeId);
  expect(Number(septemberEntry.already_paid_amount)).toBe(0);
  expect(Number(septemberEntry.carryover_amount)).toBe(0);
  expect((await db.query<{ n: number }>("select count(*)::int n from payroll_entry_items where payroll_entry_id=$1 and source_table='payroll_entries'", [septemberEntry.id])).rows[0].n).toBe(0);
});
