import {readFileSync} from 'node:fs';
import {createInvoiceLifecycleDatabase} from './clientInvoiceLifecycleDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const fiscalMigration='20260831124505_fiscal_emission_readiness.sql';
export const fiscalInvoiceGateMigration='20260831144530_attach_fiscal_invoice_gate.sql';
export async function installFiscalReadinessFixture(db:Awaited<ReturnType<typeof createInvoiceLifecycleDatabase>>['db'], options:{invoiceGate?:boolean}={}){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 for(const table of ['tenant_emitters','hub_fiscal_emissions','cte_batches','cte_documents','nfse_documents','fiscal_documents']){
  const declaration=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];
  if(!declaration)throw new Error('Missing baseline table '+table);
  const present=(await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+table])).rows[0].present;
  if(!present){await db.exec(declaration);await db.exec('alter table public.'+table+' add primary key(id)');}
  for(const match of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\n    ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(match[0]);
 }
 for(const table of ['cte_batches','cte_documents']){
  const block=baseline.match(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\n    ADD CONSTRAINT[\\s\\S]*?;'))?.[0];
  if(!block)throw new Error('Missing fiscal catalog constraints '+table);
  const checks=block.split('\n').filter(line=>line.includes(' CHECK ')).map(line=>line.trim().replace(/[,;]$/,''));
  await db.exec('alter table public.'+table+' '+checks.join(',')+';');
 }
 await db.exec('grant all on all tables in schema public to service_role');
 await db.exec(readFileSync('supabase/migrations/'+fiscalMigration,'utf8'));
 await db.exec(readFileSync('supabase/migrations/20260831153911_reconcile_unsent_fiscal_dispatch.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260831160035_reconcile_provider_rejections.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260831160938_reconcile_authorized_cte_catalog.sql','utf8'));
 if(options.invoiceGate!==false) await db.exec(readFileSync('supabase/migrations/'+fiscalInvoiceGateMigration,'utf8'));
 const emitter='fa100000-0000-4000-8000-000000000001';
 await db.query("insert into tenant_emitters(id,tenant_id,cnpj,razao_social,active) values($1,$2,'11222333000181','Emitente QA',true)",[emitter,i.tenant]);
 await db.query("update fiscal_documents set document_type='inbound',cte_emitted_at=null,cte_emitted_outbound_id=null,nfse_emitted_at=null where tenant_id=$1",[i.tenant]);
 const client=(await db.query<{id:string}>('select id from clients where tenant_id=$1 order by id limit 1',[i.tenant])).rows[0].id;
 return {emitter,client};
}
export async function createFiscalReadinessDatabase(){const {db}=await createInvoiceLifecycleDatabase();return {db,...await installFiscalReadinessFixture(db)};}
export const fiscalSnapshot=(client:string,environment='homologation')=>({client_id:client,freight_value:100,remitter:'Remetente QA',recipient:'Destinatario QA',
 cte_payload:{emitterCnpj:'11222333000181',environment,payload:{valor:100}}});
export async function prepareFiscal(db:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>['db'],emitter:string,client:string,environment='homologation',ids=[i.doc,i.doc2]){
 return (await operationRpc<{result:{id:string;cte_payload:Record<string,unknown>;recovered:boolean}}>(db,
  'select prepare_cte_issue($1,$2,$3,$4,$5::jsonb) result',[i.tenant,emitter,environment,ids,JSON.stringify(fiscalSnapshot(client,environment))])).rows[0].result;
}
export async function serviceFiscal<Row=Record<string,unknown>>(db:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>['db'],sql:string,args:unknown[]=[]){
 await db.exec('savepoint service_fiscal;set role service_role');
 try{const result=await db.query<Row>(sql,args);await db.exec('reset role;release savepoint service_fiscal');return result;}
 catch(error){await db.exec('rollback to savepoint service_fiscal;release savepoint service_fiscal');throw error;}
}
export async function claimFiscal(db:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>['db'],emitter:string,document:string,environment='homologation'){
 return (await serviceFiscal<{result:{dispatch:boolean;emission:{id:string;request_payload:Record<string,unknown>}}}>(db,
  'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,$7,null,null) result',
  [i.tenant,i.operator,emitter,'cte',environment,JSON.stringify(fiscalSnapshot('',environment).cte_payload),document])).rows[0].result;
}
export async function completeFiscal(db:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>['db'],emission:string,status='authorized',http=200){
 return serviceFiscal(db,'select complete_hub_fiscal_emission($1,$2,$3::jsonb,$4) result',[i.tenant,emission,JSON.stringify({document:{id:'hub-qa',status,number:'100',accessKey:'test-key',authorizationProtocol:'test-protocol'}}),http]);
}

