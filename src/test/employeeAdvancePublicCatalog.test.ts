// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  employeeAdvanceActionPreviewSchema,
  employeeAdvanceActionResultSchema,
} from '@/lib/financial/employeeAdvanceActionContract';
import {
  employeeAdvancePaymentHistorySchema,
  employeeAdvancePaymentOptionsSchema,
  employeeAdvancePaymentPreviewSchema,
  employeeAdvancePaymentResultSchema,
} from '@/lib/financial/employeeAdvancePaymentContract';
import { employeeAdvanceRegistrationResultSchema } from '@/lib/financial/employeeAdvanceRegistrationContract';
import { financeAs, financeIds as ids } from './helpers/financeLedgerDatabase';
import { createPayrollRecordedAdvanceDatabase } from './helpers/payrollRecordedAdvanceDatabase';

it('exposes only tenant-scoped employee-advance entrypoints through the public catalog', async () => {
  const db = await createPayrollRecordedAdvanceDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/20260911125548_finance_employee_advance_audited_lifecycle.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20260914191353_finance_employee_advance_public_catalog.sql', 'utf8'));

    const permissions = (await db.query<{ name: string; authenticated: boolean; anon: boolean; service: boolean; definer: boolean }>(`
      select proname name,
        has_function_privilege('authenticated', oid, 'execute') authenticated,
        has_function_privilege('anon', oid, 'execute') anon,
        has_function_privilege('service_role', oid, 'execute') service,
        prosecdef definer
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in (
          'record_finance_employee_advance',
          'preview_finance_employee_advance_payment',
          'record_finance_employee_advance_payment',
          'get_finance_employee_advance_payment_options',
          'get_finance_employee_advance_payment_history',
          'preview_finance_employee_advance_action',
          'apply_finance_employee_advance_action'
        )
    `)).rows;
    expect(permissions).toHaveLength(7);
    for (const permission of permissions) {
      expect(permission).toMatchObject({ authenticated: true, anon: false, service: false, definer: false });
    }
    const rawPermissions = (await db.query<{ name: string; authenticated: boolean; anon: boolean; service: boolean }>(`
      select proname name,
        has_function_privilege('authenticated', oid, 'execute') authenticated,
        has_function_privilege('anon', oid, 'execute') anon,
        has_function_privilege('service_role', oid, 'execute') service
      from pg_proc
      where pronamespace = 'finance_private'::regnamespace
        and proname in (
          'record_employee_advance',
          'employee_advance_action_context',
          'apply_employee_advance_action',
          'employee_advance_payment_context',
          'record_employee_advance_payment',
          'employee_advance_payment_options',
          'employee_advance_payment_history'
        )
    `)).rows;
    expect(rawPermissions).toHaveLength(7);
    for (const permission of rawPermissions) {
      expect(permission).toMatchObject({ authenticated: false, anon: false, service: false });
    }

    await db.exec('begin');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.operator]);
    await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2", [ids.tenant, ids.operator]);
    const today = (await db.query<{ value: string }>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text value")).rows[0].value;

    const employee = randomUUID();
    await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Public catalog employee')", [employee, ids.tenant]);
    const movement = (await financeAs<{ value: { movement_id: string } }>(
      db,
      ids.operator,
      'select public.record_finance_movement($1) value',
      [{
        version: 1,
        tenant_id: ids.tenant,
        request_id: randomUUID(),
        bank_account_id: ids.account,
        direction: 'out',
        nature: 'payment',
        amount_cents: 4000,
        occurred_on: today,
        description: 'Public employee advance movement',
        beneficiary_name: 'Public catalog employee',
        beneficiary_document: null,
        reason: 'Audited movement for public catalog test',
      }],
    )).rows[0].value.movement_id;

    await db.exec('set local role authenticated');
    const registrationPayload = {
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      employee_id: employee,
      amount_cents: '10000',
      advance_date: today,
      reason: 'Audited public employee advance registration',
      payment_method: 'pix',
      payment_reference: null,
      create_payable: false,
    } as const;
    const registration = employeeAdvanceRegistrationResultSchema.parse((await db.query<{ value: unknown }>(
      'select public.record_finance_employee_advance($1) value',
      [registrationPayload],
    )).rows[0].value);
    expect(registration).toMatchObject({
      tenant_id: ids.tenant,
      actor_id: ids.operator,
      request_id: registrationPayload.request_id,
      employee_id: employee,
      amount_cents: '10000',
      cash_created: false,
    });

    await db.exec('savepoint cross_tenant');
    await expect(db.query(
      "select public.preview_finance_employee_advance_action($1,$2,'approve')",
      [ids.otherTenant, registration.advance_id],
    )).rejects.toMatchObject({ code: '42501' });
    await db.exec('rollback to savepoint cross_tenant');

    const actionPreview = employeeAdvanceActionPreviewSchema.parse((await db.query<{ value: unknown }>(
      "select public.preview_finance_employee_advance_action($1,$2,'approve') value",
      [ids.tenant, registration.advance_id],
    )).rows[0].value);
    expect(actionPreview.can_execute).toBe(true);
    const actionPayload = {
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      advance_id: registration.advance_id,
      action: 'approve',
      expected_revision: actionPreview.revision,
      reason: 'Approved after audited public preview',
    } as const;
    const actionResult = employeeAdvanceActionResultSchema.parse((await db.query<{ value: unknown }>(
      'select public.apply_finance_employee_advance_action($1) value',
      [actionPayload],
    )).rows[0].value);
    expect(actionResult).toMatchObject({ status: 'approved', cash_changed: false });

    const paymentPreview = employeeAdvancePaymentPreviewSchema.parse((await db.query<{ value: unknown }>(
      'select public.preview_finance_employee_advance_payment($1,$2,$3,$4) value',
      [ids.tenant, registration.advance_id, movement, '4000'],
    )).rows[0].value);
    expect(paymentPreview.can_execute).toBe(true);
    const paymentPayload = {
      version: 1,
      tenant_id: ids.tenant,
      request_id: randomUUID(),
      advance_id: registration.advance_id,
      movement_id: movement,
      amount_cents: '4000',
      expected_revision: paymentPreview.revision,
      method: 'pix',
      reason: 'Paid after audited public preview',
    } as const;
    const paymentResult = employeeAdvancePaymentResultSchema.parse((await db.query<{ value: unknown }>(
      'select public.record_finance_employee_advance_payment($1) value',
      [paymentPayload],
    )).rows[0].value);
    expect(paymentResult).toMatchObject({
      status: 'approved',
      paid_cents: '4000',
      open_cents: '6000',
      cash_created: false,
      expense_created: false,
    });

    const history = employeeAdvancePaymentHistorySchema.parse((await db.query<{ value: unknown }>(
      'select public.get_finance_employee_advance_payment_history($1,$2,$3) value',
      [ids.tenant, registration.advance_id, { offset: 0, limit: 30, expected_revision: null }],
    )).rows[0].value);
    expect(history.total).toBe(1);
    expect(history.rows[0].result).toEqual(paymentResult);
    const options = employeeAdvancePaymentOptionsSchema.parse((await db.query<{ value: unknown }>(
      'select public.get_finance_employee_advance_payment_options($1,$2,$3) value',
      [ids.tenant, registration.advance_id, { offset: 0, limit: 30, search: '', expected_revision: null }],
    )).rows[0].value);
    expect(options.rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: movement })]));

    await db.exec('savepoint raw_writer');
    await expect(db.query('select finance_private.record_employee_advance_payment($1)', [paymentPayload]))
      .rejects.toMatchObject({ code: '42501' });
    await db.exec('rollback to savepoint raw_writer');

    await db.exec('reset role');
    await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)', [randomUUID(), ids.tenant, ids.operator]);
    await db.exec('set local role authenticated');
    await db.exec('savepoint mixed_role');
    await expect(db.query(
      "select public.preview_finance_employee_advance_action($1,$2,'cancel')",
      [ids.tenant, registration.advance_id],
    )).rejects.toMatchObject({ code: '42501' });
    await db.exec('rollback to savepoint mixed_role');
    await db.exec('reset role');
    await db.exec('set constraints all immediate');
    await db.exec('rollback');
  } finally {
    await db.close();
  }
}, 60_000);
