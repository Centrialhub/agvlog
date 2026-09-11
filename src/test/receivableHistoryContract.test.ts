import {describe,it,expect} from 'vitest';
import {receivableHistorySchema,receivableHistoryRequestSchema} from '@/lib/financial/receivableHistoryContract';
import {receivableHistoryFixture,historyIds} from './helpers/receivableHistoryFixture';
describe('captured receivable history contract',()=>{
 it('preserves exact cents beyond Number precision and unknown values without a balance claim',()=>{
  const data=receivableHistoryFixture();data.rows[0].after!.amount_cents='900719925474099312';data.rows[0].after!.received_cents=null;data.rows[0].after!.issues=['received_amount_unknown'];
  expect(receivableHistorySchema.parse(data).rows[0].after).toMatchObject({amount_cents:'900719925474099312',received_cents:null});
 });
 it('retains a deleted title as a tombstone and rejects a fabricated after state',()=>{
  const data=receivableHistoryFixture();const row=data.rows[0];row.operation='DELETE';row.before=row.after;row.after=null;
  expect(receivableHistorySchema.safeParse(data).success).toBe(true);row.after=row.before;
  expect(receivableHistorySchema.safeParse(data).success).toBe(false);
 });
 it('rejects foreign payer data, incorrect identity and false system attribution',()=>{
  const foreign=receivableHistoryFixture();foreign.rows[0].after!.payer!.tenant_id=historyIds.actor;
  expect(receivableHistorySchema.safeParse(foreign).success).toBe(false);
  const identity=receivableHistoryFixture();identity.rows[0].after!.payer!.id=historyIds.actor;
  expect(receivableHistorySchema.safeParse(identity).success).toBe(false);
  const actor=receivableHistoryFixture();actor.rows[0].actor_id=historyIds.actor;
  expect(receivableHistorySchema.safeParse(actor).success).toBe(false);
 });
 it('rejects missing rows, repeated events and ascending sequence without interpreting commit order',()=>{
  const data=receivableHistoryFixture();data.total=2;
  expect(receivableHistorySchema.safeParse(data).success).toBe(false);
  data.rows.push(structuredClone(data.rows[0]));expect(receivableHistorySchema.safeParse(data).success).toBe(false);
  data.rows[1].event_order='2';expect(receivableHistorySchema.safeParse(data).success).toBe(false);
  data.rows.reverse();expect(receivableHistorySchema.safeParse(data).success).toBe(true);
 });
 it('rejects invalid money, impossible calendar days and events without coverage safely',()=>{
  const data=receivableHistoryFixture();data.rows[0].after!.amount_cents='10.5';
  expect(receivableHistorySchema.safeParse(data).success).toBe(false);
  data.rows[0].after!.amount_cents='100';data.rows[0].after!.due_date='2026-02-30';
  expect(receivableHistorySchema.safeParse(data).success).toBe(false);
  data.rows[0].after!.due_date=null;data.coverage=null;
  expect(receivableHistorySchema.safeParse(data).success).toBe(false);
 });
 it('requires the captured set revision for subsequent pages',()=>{
  const input={tenantId:historyIds.tenant,receivableId:null,page:2,expectedRevision:null};
  expect(receivableHistoryRequestSchema.safeParse(input).success).toBe(false);
  expect(receivableHistoryRequestSchema.safeParse({...input,expectedRevision:'a'.repeat(32)}).success).toBe(true);
 });
});
