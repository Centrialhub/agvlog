// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createReceivableFinancialDatabase,createFinancialScenario,financialPayload,financialCommand,financialContext} from './helpers/receivableFinancialDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
beforeAll(async()=>{({db}=await createReceivableFinancialDatabase());const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');for(const name of ['ux_charges_active_source','ux_client_invoices_tenant_number']){const sql=baseline.match(new RegExp('CREATE UNIQUE INDEX '+name+' [^;]+;'))?.[0];if(!sql)throw new Error('Missing real baseline index');await db.exec(sql);}},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('reproduction of the remaining legacy invoice lifecycle',{timeout:15000},()=>{
 it('cancels an unpaid invoice and receivable while leaving its closing invoiced',async()=>{
  const s=await createFinancialScenario(db);await operationRpc(db,'select cancel_client_invoice($1,$2)',[s.invoice,'Cancelamento QA legado']);
  expect((await db.query('select status from client_invoices where id=$1',[s.invoice])).rows[0]).toEqual({status:'cancelled'});
  expect((await db.query('select status from receivables where id=$1',[s.receivable])).rows[0]).toEqual({status:'cancelled'});
  expect((await db.query('select status from closing_reports where id=$1',[s.report])).rows[0]).toEqual({status:'invoiced'});
  expect(await financialContext(db,s.receivable)).toMatchObject({requires_reconciliation:true,can_receive:false});
 });
 it('can cancel a fully collected invoice while retaining a paid closing and received title',async()=>{
  const s=await createFinancialScenario(db);await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));await operationRpc(db,'select cancel_client_invoice($1,$2)',[s.invoice,'Cancelamento QA recebido']);
  expect((await db.query('select status from client_invoices where id=$1',[s.invoice])).rows[0]).toEqual({status:'cancelled'});
  expect((await db.query('select status from closing_reports where id=$1',[s.report])).rows[0]).toEqual({status:'paid'});
  expect(await financialContext(db,s.receivable)).toMatchObject({received_cents:24000,requires_reconciliation:true});
 });
 it('does not return the original invoice acknowledgement when closing generation is retried',async()=>{
  const s=await createFinancialScenario(db);await expect(operationRpc(db,'select generate_client_invoice_from_closing($1)',[s.report])).rejects.toThrow('must_be_closed_or_sent');
  expect((await db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:1});
 });
});
