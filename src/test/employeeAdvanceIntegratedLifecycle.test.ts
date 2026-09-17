// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { financeAs, financeIds as ids } from './helpers/financeLedgerDatabase';
import { createPayrollRecordedAdvanceDatabase } from './helpers/payrollRecordedAdvanceDatabase';

it('installs payment, payroll and audited lifecycle together and protects a materialized advance', async () => {
  const db = await createPayrollRecordedAdvanceDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/20260911125548_finance_employee_advance_audited_lifecycle.sql', 'utf8'));
    await db.exec('begin');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.operator]);
    await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2", [ids.tenant, ids.operator]);
    const today = (await db.query<{ value: string }>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text value")).rows[0].value;

    const employee = randomUUID();
    await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Integrated advance employee')", [employee, ids.tenant]);
    await db.query("insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values($1,$2,'fixed','2026-01-01',1000)", [ids.tenant, employee]);

    const registration = {
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      employee_id: employee,
      amount_cents: '10000',
      advance_date: today,
      reason: 'Integrated audited employee advance',
      payment_method: 'pix',
      payment_reference: null,
      create_payable: false,
    };
    const advance = (await db.query<{ value: { advance_id: string } }>(
      'select finance_private.record_employee_advance($1) value',
      [registration],
    )).rows[0].value.advance_id;
    const pendingPayment = (await db.query<{ value: { eligible: boolean; blockers: string[] } }>(
      'select finance_private.employee_advance_payment_context($1,$2,$3,$4) value',
      [ids.tenant, advance, randomUUID(), '4000'],
    )).rows[0].value;
    expect(pendingPayment.eligible).toBe(false);
    expect(pendingPayment.blockers).toContain('finance_advance_movement_required');
    expect(pendingPayment.blockers).not.toContain('finance_advance_not_payable');

    const movement = (await financeAs<{ value: { movement_id: string } }>(db, ids.operator, 'select record_finance_movement($1) value', [{
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      bank_account_id: ids.account,
      direction: 'out',
      nature: 'payment',
      amount_cents: 4000,
      occurred_on: today,
      description: 'Partial employee advance delivery',
      beneficiary_name: 'Integrated advance employee',
      beneficiary_document: null,
      reason: 'Recorded cash movement for advance integration',
    }])).rows[0].value.movement_id;
    const payment = (await db.query<{ value: { revision: string; eligible: boolean } }>(
      'select finance_private.employee_advance_payment_context($1,$2,$3,$4) value',
      [ids.tenant, advance, movement, '4000'],
    )).rows[0].value;
    expect(payment.eligible).toBe(true);
    const paymentResult = (await db.query<{ value: { status: string } }>(
      'select finance_private.record_employee_advance_payment($1) value',
      [{
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      advance_id: advance,
      movement_id: movement,
      amount_cents: '4000',
      expected_revision: payment.revision,
      method: 'pix',
      reason: 'Partial delivery reviewed for payroll',
      }],
    )).rows[0].value;
    expect(paymentResult.status).toBe('approved');
    expect((await db.query<{ status: string; approved_by: string }>(
      'select status,approved_by from employee_advances where tenant_id=$1 and id=$2',
      [ids.tenant, advance],
    )).rows[0]).toEqual({ status: 'approved', approved_by: ids.operator });

    const period = (await financeAs<{ id: string }>(
      db,
      ids.operator,
      "select generate_payroll_period($1,date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month -1 day')::date) id",
      [ids.tenant],
    )).rows[0].id;
    await financeAs(db, ids.operator, 'select approve_payroll_period($1)', [period]);

    await db.exec('savepoint late_registration');
    await expect(db.query('select finance_private.record_employee_advance($1)', [{
      ...registration,
      request_id: randomUUID(),
      reason: 'Backdated advance after payroll approval',
    }])).rejects.toThrow('finance_advance_materialized_in_payroll');
    await db.exec('rollback to savepoint late_registration');

    const cancellation = (await db.query<{ value: { revision: string; eligible: boolean; blockers: string[] } }>(
      "select finance_private.employee_advance_action_context($1,$2,'cancel') value",
      [ids.tenant, advance],
    )).rows[0].value;
    expect(cancellation.eligible).toBe(false);
    expect(cancellation.blockers).toEqual(expect.arrayContaining([
      'finance_advance_payment_history_requires_resolution',
      'finance_advance_payroll_requires_resolution',
    ]));
    await db.exec('savepoint protected_action');
    await expect(db.query('select finance_private.apply_employee_advance_action($1)', [{
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      advance_id: advance,
      action: 'cancel',
      expected_revision: cancellation.revision,
      reason: 'Attempt after payroll materialization',
    }])).rejects.toMatchObject({ code: '55000' });
    await db.exec('rollback to savepoint protected_action');

    await db.exec('savepoint cross_tenant');
    await expect(db.query(
      "select finance_private.employee_advance_action_context($1,$2,'cancel')",
      [ids.otherTenant, advance],
    )).rejects.toMatchObject({ code: '42501' });
    await db.exec('rollback to savepoint cross_tenant');

    expect((await db.query<{ total: number }>(
      "select count(*)::int total from finance_events where tenant_id=$1 and entity_type='employee_advance' and entity_id=$2",
      [ids.tenant, advance],
    )).rows[0].total).toBe(2);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
}, 60_000);
