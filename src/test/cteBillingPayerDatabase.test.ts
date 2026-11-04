// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createFiscalReadinessDatabase,fiscalSnapshot,claimFiscal,completeFiscal} from './helpers/fiscalReadinessDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {manualInvoiceDraft,directInvoicePayload,invoiceCommand,invoiceCreationContext} from './helpers/clientInvoiceLifecycleDatabase';
const migration=readFileSync('supabase/migrations/20261104194722_resolve_cte_billing_payer.sql','utf8');
let ctx:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
const payer='ac100000-0000-4000-8000-000000000001';
const branch='ac100000-0000-4000-8000-000000000002';
beforeAll(async()=>{ctx=await createFiscalReadinessDatabase();
 await ctx.db.exec('alter table cte_documents add column if not exists payer_name text,add column if not exists payer_cnpj text; alter table receivables add column if not exists cte_document_id uuid;');
},30000);
beforeEach(async()=>{await ctx.db.exec('begin');
 await ctx.db.query("insert into clients(id,tenant_id,company_name,tax_id,active) values($1,$3,'Mesmo nome','14.998.371/0032-15',true),($2,$3,'Mesmo nome','14.998.371/0031-34',true)",[payer,branch,i.tenant]);
});
afterEach(async()=>{await ctx.db.exec('rollback');});afterAll(async()=>{await ctx?.db.close();});
async function authorized(party:Record<string,unknown>={cnpj:'14998371003215',nome:'Mesmo nome'},role='remetente',tipo=0){
 const snapshot={...fiscalSnapshot(ctx.client,'production'),cte_payload:{emitterCnpj:'11222333000181',environment:'production',payload:{tomador:{role,tipo,...(role==='terceiro'?party:{})},[role]:party}}};
 const doc=(await operationRpc<{result:{id:string}}>(ctx.db,'select prepare_cte_issue($1,$2,$3,$4,$5::jsonb) result',[i.tenant,ctx.emitter,'production',[i.doc,i.doc2],snapshot])).rows[0].result;
 const claim=await claimFiscal(ctx.db,ctx.emitter,doc.id,'production');await completeFiscal(ctx.db,claim.emission.id);return doc.id;
}
async function catalog(id:string){return (await ctx.db.query('select client_id,payer_cnpj from cte_documents where id=$1',[id])).rows[0];}
async function draft(id:string,client=payer){const value=await manualInvoiceDraft(ctx.db);value.client_id=client;
 value.charges=[{source_type:'cte_document',source_id:id,description:'CT-e QA',gross_amount:100,net_amount:100,sort_order:0}] as unknown as typeof value.charges;return value;}
it('reproduz ausência no remetente e corrige catálogo existente sem alterar snapshot fiscal',async()=>{
 const id=await authorized();expect(await catalog(id)).toMatchObject({client_id:ctx.client});
 const before=(await ctx.db.query('select cte_payload,client_id from fiscal_documents where id=$1',[id])).rows;
 await ctx.db.exec(migration);expect(await catalog(id)).toEqual({client_id:payer,payer_cnpj:'14998371003215'});
 expect((await ctx.db.query('select cte_payload,client_id from fiscal_documents where id=$1',[id])).rows).toEqual(before);
 const payload=await directInvoicePayload(ctx.db,await draft(id));const ack=await invoiceCommand(ctx.db,payload);
 expect((await invoiceCommand(ctx.db,payload)).invoice_id).toBe(ack.invoice_id);
 await expect(invoiceCreationContext(ctx.db,null,await draft(id,ctx.client))).rejects.toThrow();
});
it('novas autorizações usam CNPJ exato da filial mesmo com nomes iguais',async()=>{
 await ctx.db.exec(migration);const id=await authorized({cnpj:'14998371003134',nome:'Mesmo nome'});
 expect(await catalog(id)).toEqual({client_id:branch,payer_cnpj:'14998371003134'});
 await expect(invoiceCreationContext(ctx.db,null,await draft(id))).rejects.toThrow('invoice_source_changed');
 expect((await invoiceCreationContext(ctx.db,null,await draft(id,branch))).can_generate).toBe(true);
});
it('recusa prévia obsoleta do destinatário após correção do catálogo',async()=>{
 const id=await authorized();const payload=await directInvoicePayload(ctx.db,await draft(id,ctx.client));
 await ctx.db.exec(migration);await expect(invoiceCommand(ctx.db,payload)).rejects.toThrow();
 expect((await ctx.db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:0});
});
it('preserva CT-e já faturado e sua cobrança',async()=>{
 const id=await authorized();const ack=await invoiceCommand(ctx.db,await directInvoicePayload(ctx.db,await draft(id,ctx.client)));
 await ctx.db.exec(migration);expect(await catalog(id)).toMatchObject({client_id:ctx.client});
 expect((await ctx.db.query('select client_id from client_invoices where id=$1',[ack.invoice_id])).rows[0]).toEqual({client_id:ctx.client});
});
it.each(['ausente','duplicado','outra empresa','inativo'])('não usa destinatário como fallback para tomador %s',async(mode)=>{
 if(mode==='ausente')await ctx.db.query('delete from clients where id=$1',[payer]);
 if(mode==='duplicado')await ctx.db.query("update clients set tax_id='14998371003215' where id=$1",[branch]);
 if(mode==='outra empresa')await ctx.db.query('update clients set tenant_id=$1 where id=$2',[i.otherTenant,payer]);
 if(mode==='inativo')await ctx.db.query('update clients set active=false where id=$1',[payer]);
 await ctx.db.exec(migration);expect(await catalog(await authorized())).toMatchObject({client_id:null});
});
it('tomador terceiro é identificado pelo próprio documento e função não fica exposta',async()=>{
 await ctx.db.exec(migration);expect(await catalog(await authorized({cnpj:'14998371003215',nome:'Mesmo nome'},'terceiro',4))).toMatchObject({client_id:payer});
 expect((await ctx.db.query("select has_function_privilege('authenticated','private.resolve_cte_catalog_payer_v1()','execute') allowed")).rows[0]).toEqual({allowed:false});
});
it.each([['expedidor',1],['recebedor',2],['destinatario',3]] as const)('resolve papel %s pelo documento da parte correspondente',async(role,tipo)=>{
 await ctx.db.exec(migration);expect(await catalog(await authorized(undefined,role,tipo))).toMatchObject({client_id:payer});
});
it('papel e código conflitantes não cobram o destinatário',async()=>{
 await ctx.db.exec(migration);expect(await catalog(await authorized(undefined,'remetente',3))).toMatchObject({client_id:null});
});
it('preserva vínculo com recebível e permite retorno do código sem invalidar catálogo corrigido',async()=>{
 const id=await authorized();await ctx.db.query('update cte_documents set receivable_id=$1 where id=$2',[i.doc,id]);
 await ctx.db.exec(migration);expect(await catalog(id)).toMatchObject({client_id:ctx.client});
 await ctx.db.exec('drop trigger cte_catalog_payer_v1 on cte_documents;drop function private.resolve_cte_catalog_payer_v1();');
 expect(await catalog(id)).toMatchObject({client_id:ctx.client});
});
