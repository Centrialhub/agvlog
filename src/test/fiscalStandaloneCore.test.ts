// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createInvoiceLifecycleDatabase } from './helpers/clientInvoiceLifecycleDatabase';
import { installFiscalReadinessFixture, prepareFiscal, claimFiscal, completeFiscal } from './helpers/fiscalReadinessDatabase';

describe('standalone fiscal rollout', () => {
  it('prepares and confirms CT-e without publishing the invoice lifecycle gate', async () => {
    const {db} = await createInvoiceLifecycleDatabase();
    try {
      await db.exec('drop function public._client_invoice_draft_snapshot(uuid,jsonb,boolean,uuid)');
      const {emitter, client} = await installFiscalReadinessFixture(db, {invoiceGate:false});
      await db.exec('begin');
      const doc = await prepareFiscal(db, emitter, client);
      const first = await claimFiscal(db, emitter, doc.id);
      expect(first.dispatch).toBe(true);
      expect((await claimFiscal(db, emitter, doc.id)).dispatch).toBe(false);
      await completeFiscal(db, first.emission.id);
      expect((await db.query('select status from fiscal_documents where id=$1',[doc.id])).rows).toEqual([{status:'authorized'}]);
      expect((await db.query("select to_regprocedure('public._client_invoice_draft_snapshot(uuid,jsonb,boolean,uuid)') is null absent")).rows).toEqual([{absent:true}]);
      await db.exec('rollback');
    } finally {await db.close();}
  }, 20000);
});
