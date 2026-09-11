import {directInvoicePayload,invoiceCommand,invoiceContext,invoiceActionPayload} from './helpers/clientInvoiceLifecycleDatabase';
// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {readFileSync,writeFileSync} from 'node:fs';
import {it,expect} from 'vitest';import {createCustomerCreditApplicationDatabase,seedCustomerCreditApplicationSource} from './helpers/customerCreditApplicationDatabase';
it('installs actual current fiscal/invoice/ledger predecessors',async()=>{const db=await createCustomerCreditApplicationDatabase();try{await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));expect((await db.query("select to_regprocedure('public._receivable_ledger_evidence(uuid,uuid)') is not null v")).rows).toEqual([{v:true}]);const catalog=await db.query(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) normalized_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='finance_private' and (p.proname like '%customer_credit%' or p.proname in('receivable_credit_evidence','cash_receivable_ledger_evidence','sync_credit_application_projection','process_fiscal_observation','audit_events'))) or (n.nspname='public' and p.proname in('_receivable_ledger_evidence','_receivable_financial_snapshot','_recalc_receivable_received','_guard_receivable_ledger','_invoice_lifecycle_snapshot','apply_client_invoice_command')) order by 1`);writeFileSync('docs/qa/finance-customer-credit-core-catalog-2026-09-11.json',JSON.stringify(catalog.rows,null,2)+'\n','utf8');}finally{await db.close();}},30000);

it('applies and releases real cancellation credit without a new payment, keeping later observations valid',async()=>{const db=await createCustomerCreditApplicationDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
const {payer,emission,credit,process}=await seedCustomerCreditApplicationSource(db);
 const target=(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,50,0,'pending','New real debt') returning id",[i.tenant,payer])).rows[0].id;
 const preview=async(amount:string,application:string|null=null)=>(await db.query<{v:{revision:string,eligible:boolean,blockers:string[]}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,$5) v',[i.tenant,credit,target,amount,application])).rows[0].v;
 const context=await preview('4000');expect(context).toMatchObject({eligible:true,blockers:[]});
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,application_id:null,action:'apply',amount_cents:'4000',expected_revision:context.revision,reason:'Aplicação real de crédito existente'};
 const write=async(value:unknown)=>(await db.query<{v:{application_id:string}}> ('select finance_private.record_customer_credit_application($1) v',[value])).rows[0].v;
 const result=await write(payload);expect(await write(payload)).toEqual(result);
 const snapshot=async()=>(await db.query<{v:Record<string,unknown>}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,target])).rows[0].v;
 expect(await snapshot()).toMatchObject({cash_received_cents:0,credit_applied_cents:4000,settled_cents:4000,open_cents:1000});
 await db.query('update hub_fiscal_emissions set provider_document_version=2 where id=$1',[emission]);expect((await process()).status).toBe('applied');
 expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v).toMatchObject({valid:true,available_cents:'6000'});
 const release=await preview('4000',result.application_id);expect(release.eligible).toBe(true);
 await write({...payload,request_id:randomUUID(),action:'release',application_id:result.application_id,expected_revision:release.revision});
 expect(await snapshot()).toMatchObject({cash_received_cents:0,credit_applied_cents:0,settled_cents:0,open_cents:5000});
 const audit=(await db.query<{v:{rows:Array<{action:string,manual_intervention:boolean}>}}>("select finance_private.audit_events($1,'{\"manual_only\":true}') v",[i.tenant])).rows[0].v;expect(audit.rows.filter(row=>row.action.startsWith('customer_credit_')).map(row=>[row.action,row.manual_intervention]).sort()).toEqual([['customer_credit_application_released',true],['customer_credit_applied',true]]);
 expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>('select count(*)::int n from receivables_payments')).rows[0].n).toBe(1);
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);


it('fiscal cancellation releases applied credit with a system observation and no second cash credit',async()=>{const db=await createCustomerCreditApplicationDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
 const {payer,credit}=await seedCustomerCreditApplicationSource(db);const cte=randomUUID(),emission=randomUUID();
 await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,50,50)',[cte,i.tenant,payer]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'456')",[emission,i.tenant,cte,'3'.repeat(44),'4'.repeat(15)]);
 const process=async()=>{const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;return(await operationRpc<{v:{status:string,receivable_id:string}}>(db,'select process_finance_fiscal_observation($1,$2) v',[i.tenant,observation])).rows[0].v;};
 const first=await process();expect(first.status).toBe('applied');
 const ctx=(await db.query<{v:{revision:string,eligible:boolean}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[i.tenant,credit,first.receivable_id,'4000'])).rows[0].v;expect(ctx.eligible).toBe(true);
 await db.query('select finance_private.record_customer_credit_application($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:first.receivable_id,application_id:null,action:'apply',amount_cents:'4000',expected_revision:ctx.revision,reason:'Crédito aplicado antes do cancelamento'}]);
 await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[emission]);
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;
 await db.query("select set_config('request.jwt.claim.sub','',true)");expect((await db.query<{v:{status:string}}>('select finance_private.process_fiscal_observation($1,$2) v',[i.tenant,observation])).rows[0].v.status).toBe('applied');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v).toMatchObject({valid:true,available_cents:'10000',applied_cents:'0'});
 expect((await db.query('select status,(received_amount*100)::bigint::text as received_amount from receivables where id=$1',[first.receivable_id])).rows[0]).toEqual({status:'cancelled',received_amount:'0'});
 expect((await db.query<{n:number}>('select count(*)::int n from finance_customer_credits')).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(1);
 expect((await db.query('select actor_id,observation_id is not null observed from finance_private.customer_credit_application_events where action=\'release\'')).rows).toEqual([{actor_id:null,observed:true}]);
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);

it('invoice cancellation restores existing credit and preserves the invoice audit graph',async()=>{const db=await createCustomerCreditApplicationDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
 const {payer,credit}=await seedCustomerCreditApplicationSource(db);
 await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true) on conflict do nothing",[i.tenant,i.operator]);
 const draft={tenant_id:i.tenant,client_id:payer,issue_date:'2026-08-30',due_date:null,discount_amount:0,interest_amount:0,notes:null,charges:[{source_type:'manual_service',description:'Serviço auditado',gross_amount:50,net_amount:50,sort_order:0}]};
 const created=await invoiceCommand(db,await directInvoicePayload(db,draft));
 const ctx=(await db.query<{v:{revision:string,eligible:boolean}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[i.tenant,credit,created.receivable_id,'4000'])).rows[0].v;expect(ctx.eligible).toBe(true);
 await db.query('select finance_private.record_customer_credit_application($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:created.receivable_id,application_id:null,action:'apply',amount_cents:'4000',expected_revision:ctx.revision,reason:'Crédito aplicado à fatura comercial'}]);
 expect(await invoiceContext(db,created.invoice_id)).toMatchObject({can_cancel:true,requires_reconciliation:false,received_cents:4000});
 const cancel=await invoiceActionPayload(db,created.invoice_id);const result=await invoiceCommand(db,cancel);expect(await invoiceCommand(db,cancel)).toEqual(result);
 expect(await invoiceContext(db,created.invoice_id)).toMatchObject({status:'cancelled',received_cents:0,open_cents:0,requires_reconciliation:false});
 expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v).toMatchObject({valid:true,available_cents:'10000'});
 expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(1);await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);

it('rejects wrong payer, stale revision, excess credit and rollback residue',async()=>{const db=await createCustomerCreditApplicationDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
 const {payer,credit}=await seedCustomerCreditApplicationSource(db);
 const makeTarget=async(client:string,amount:number)=>(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,$3,0,'pending','Crédito teste limites') returning id",[i.tenant,client,amount])).rows[0].id;
 const target=await makeTarget(payer,200);const foreignPayer=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Outro pagador QA',true)",[foreignPayer,i.tenant]);const wrong=await makeTarget(foreignPayer,200);
 const preview=async(id:string,amount:string)=>(await db.query<{v:{revision:string,eligible:boolean,blockers:string[]}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[i.tenant,credit,id,amount])).rows[0].v;
 expect((await preview(wrong,'4000')).blockers).toContain('credit_payer_mismatch');expect((await preview(target,'10001')).blockers).toContain('credit_capacity_exceeded');
 const ctx=await preview(target,'4000');const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,action:'apply',amount_cents:'4000',expected_revision:ctx.revision,reason:'Aplicação validada em cenário negativo'};
 const fail=async(value:unknown,code:string)=>{await db.exec('savepoint negative_case');await expect(db.query('select finance_private.record_customer_credit_application($1)',[value])).rejects.toMatchObject({code});await db.exec('rollback to savepoint negative_case');};
 await fail({...payload,expected_revision:'0'.repeat(32)},'40001');
 await fail({...payload,receivable_id:wrong,expected_revision:(await preview(wrong,'4000')).revision},'23514');
 await fail({...payload,amount_cents:'10001',expected_revision:(await preview(target,'10001')).revision},'23514');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_private.customer_credit_application_events')).rows[0].n).toBe(0);
 expect((await db.query<{n:number}>("select count(*)::int n from finance_events where entity_type='customer_credit_application'")).rows[0].n).toBe(0);
 await db.query('select finance_private.record_customer_credit_application($1)',[payload]);
 await fail({...payload,reason:'Mudança indevida do pedido'},'23514');
 const second=await preview(target,'7000');expect(second.blockers).toContain('credit_capacity_exceeded');
 const otherTarget=await makeTarget(payer,50);const otherPreview=await preview(otherTarget,'5000');await db.query('select finance_private.record_customer_credit_application($1)',[{...payload,request_id:randomUUID(),receivable_id:otherTarget,amount_cents:'5000',expected_revision:otherPreview.revision}]);expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v).toMatchObject({valid:true,applied_cents:'9000',available_cents:'1000'});
 await db.exec('savepoint revoke_access');await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(db.query('select finance_private.record_customer_credit_application($1)',[payload])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint revoke_access');
 await db.exec('savepoint corrupt_source');await db.query('update clients set id=id where id=$1',[payer]);
 await db.query('update receivables set client_id=$1 where id=$2',[foreignPayer,target]).then(()=>{throw new Error('payer identity unexpectedly changed');},(error:unknown)=>expect(error).toMatchObject({code:'55000',message:'financial_receivable_identity_is_immutable'}));await db.exec('rollback to savepoint corrupt_source');
 expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(1);
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);

it('fails closed on a changed predecessor and rolls all candidate DDL back',async()=>{const db=await createCustomerCreditApplicationDatabase();try{
 await db.exec("create or replace function public._receivable_ledger_evidence(_tenant uuid,_id uuid) returns table(net numeric,payment_count bigint,valid boolean) language sql stable set search_path='' as 'select 0::numeric,0::bigint,false'");
 await db.exec('begin');await expect(db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'))).rejects.toMatchObject({code:'55000'});await db.exec('rollback');
 expect((await db.query("select to_regclass('finance_private.customer_credit_application_events') is null absent")).rows).toEqual([{absent:true}]);
 }finally{await db.close();}},30000);
