import {randomUUID} from 'node:crypto';
import {financeIds as i} from './helpers/financeLedgerDatabase';
// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {createCustomerCreditRefundDatabase,seedCustomerCreditRefundSource} from './helpers/customerCreditRefundDatabase';
it('retains actual global outgoing allocation and movement guards for the later refund integration',async()=>{const db=await createCustomerCreditRefundDatabase();try{
 const rows=(await db.query(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) normalized_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('customer_credit_position','movement_used_cents','movement_recording_origin','check_movement_use','check_payable_payment_insert','check_settlement_movement_link','assert_closed_source_mutable') order by 1`)).rows;
 expect(rows.length).toBeGreaterThanOrEqual(5);await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));const effective=(await db.query(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) normalized_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and (p.proname like '%customer_credit%' or p.proname like '%customer_refund%' or p.proname in('movement_used_cents','audit_events')) order by 1`)).rows;writeFileSync('docs/qa/finance-customer-credit-refund-core-catalog-2026-09-11.json',JSON.stringify(effective,null,2)+'\n','utf8');writeFileSync('docs/qa/finance-customer-credit-refund-local-predecessors-2026-09-11.json',JSON.stringify(rows,null,2)+'\n','utf8');
 }finally{await db.close();}},30000);

it('links a real refund200 then applies400 from credit600 without creating money twice',async()=>{const db=await createCustomerCreditRefundDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));
 const {credit,target,day}=await seedCustomerCreditRefundSource(db);
 const movement=(await db.query<{v:{movement_id:string}}>('select public.record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'refund',amount_cents:20000,occurred_on:day,description:'Devolução registrada ao cliente',beneficiary_name:'Crédito para previsão',beneficiary_document:'11.222.333/0001-81',reason:'Saída real anteriormente conferida'}])).rows[0].v.movement_id;
 const before=(await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows;const originalCredit=(await db.query('select to_jsonb(c) v from finance_customer_credits c where id=$1',[credit])).rows;
 const ctx=(await db.query<{v:{revision:string,eligible:boolean,blockers:string[]}}>('select finance_private.customer_credit_refund_context($1,$2,$3,$4) v',[i.tenant,credit,movement,'20000'])).rows[0].v;expect(ctx).toMatchObject({eligible:true,blockers:[]});
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,outgoing_movement_id:movement,amount_cents:'20000',expected_revision:ctx.revision,reason:'Vincular saída real à devolução do crédito'};
 const result=(await db.query<{v:unknown}>('select finance_private.record_customer_credit_refund($1) v',[payload])).rows[0].v;expect((await db.query<{v:unknown}>('select finance_private.record_customer_credit_refund($1) v',[payload])).rows[0].v).toEqual(result);
 const position=async()=>(await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v;
 expect(await position()).toMatchObject({valid:true,original_cents:'60000',returned_cents:'20000',available_cents:'40000'});
 await db.query("select set_config('request.jwt.claim.sub','',true)");expect(await position()).toMatchObject({valid:true,returned_cents:'20000'});await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 const audit=(await db.query<{v:{rows:Array<{action:string,manual_intervention:boolean}>}}>("select finance_private.audit_events($1,'{\"manual_only\":true,\"action\":\"customer_credit_refunded\"}') v",[i.tenant])).rows[0].v;expect(audit.rows).toHaveLength(1);expect(audit.rows[0]).toMatchObject({action:'customer_credit_refunded',manual_intervention:true});
 const application=(await db.query<{v:{revision:string,eligible:boolean}}> ('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[i.tenant,credit,target,'40000'])).rows[0].v;expect(application.eligible).toBe(true);
 await db.query('select finance_private.record_customer_credit_application($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,application_id:null,action:'apply',amount_cents:'40000',expected_revision:application.revision,reason:'Aplicar somente o crédito remanescente'}]);
 expect(await position()).toMatchObject({valid:true,applied_cents:'40000',returned_cents:'20000',available_cents:'0'});
 const app=(await db.query<{id:string}>('select id from finance_private.customer_credit_application_events where credit_id=$1 and action=\'apply\'',[credit])).rows[0].id;
 const release=(await db.query<{v:{revision:string}}> ('select finance_private.customer_credit_application_context($1,$2,$3,$4,$5) v',[i.tenant,credit,target,'40000',app])).rows[0].v;
 await db.query('select finance_private.record_customer_credit_application($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,application_id:app,action:'release',amount_cents:'40000',expected_revision:release.revision,reason:'Liberar aplicação sem desfazer devolução real'}]);expect(await position()).toMatchObject({valid:true,applied_cents:'0',returned_cents:'20000',available_cents:'40000'});
 await db.exec('savepoint cannot_void');await expect(db.query("insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values($1,$2,$3,$4,'void',$5,'QA','Não pode apagar devolução',$6,'{\"proof\":true}')",[i.tenant,movement,randomUUID(),randomUUID(),i.operator,'a'.repeat(32)])).rejects.toMatchObject({code:'55000',message:'finance_credit_refund_movement_protected'});await db.exec('rollback to savepoint cannot_void');
 await db.exec('savepoint source_immutable');await expect(db.query('update finance_customer_credits set amount_cents=1 where id=$1',[credit])).rejects.toThrow();await db.exec('rollback to savepoint source_immutable');
 await db.exec('savepoint revoked');await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(db.query('select finance_private.record_customer_credit_refund($1)',[payload])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint revoked');

 expect((await db.query<{v:string}>('select finance_private.movement_used_cents($1,$2)::text v',[i.tenant,movement])).rows[0].v).toBe('20000');
 expect((await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows).toEqual(before);expect((await db.query('select to_jsonb(c) v from finance_customer_credits c where id=$1',[credit])).rows).toEqual(originalCredit);
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);

it('shares outgoing capacity with a real payable payment and rejects document mismatch and excess',async()=>{const db=await createCustomerCreditRefundDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));const {credit,day}=await seedCustomerCreditRefundSource(db);
 const movement=async(doc:string)=>(await db.query<{v:{movement_id:string}}>('select public.record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:30000,occurred_on:day,description:'Saída compartilhada comprovada',beneficiary_name:'Crédito para previsão',beneficiary_document:doc,reason:'Registro real para capacidade compartilhada'}])).rows[0].v.movement_id;
 const outgoing=await movement('11222333000181');const wrong=await movement('22333444000182');
 const preview=async(id:string,amount:string)=>(await db.query<{v:{revision:string,eligible:boolean,blockers:string[]}}>('select finance_private.customer_credit_refund_context($1,$2,$3,$4) v',[i.tenant,credit,id,amount])).rows[0].v;
 expect((await preview(wrong,'10000')).blockers).toContain('credit_refund_payer_unproven');
 const payable=(await db.query<{id:string}>("insert into payables(id,tenant_id,supplier_name,category,amount,status) values(gen_random_uuid(),$1,'Crédito para previsão','other',100,'approved') returning id",[i.tenant])).rows[0].id;
 await db.query('select public.apply_finance_payable_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:payable,movement_id:outgoing,amount_cents:10000,method:'pix',reason:'Pagamento real usa primeira parte da saída'}]);
 expect((await preview(outgoing,'20001')).blockers).toContain('credit_refund_movement_capacity_exceeded');
 const ctx=await preview(outgoing,'20000');expect(ctx.eligible).toBe(true);await db.query('select finance_private.record_customer_credit_refund($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,outgoing_movement_id:outgoing,amount_cents:'20000',expected_revision:ctx.revision,reason:'Devolver somente a parte ainda disponível'}]);
 expect((await db.query<{v:string}>('select finance_private.movement_used_cents($1,$2)::text v',[i.tenant,outgoing])).rows[0].v).toBe('30000');
 const second=(await db.query<{id:string}>("insert into payables(id,tenant_id,supplier_name,category,amount,status) values(gen_random_uuid(),$1,'Crédito para previsão','other',1,'approved') returning id",[i.tenant])).rows[0].id;
 await db.exec('savepoint excess');await expect(db.query('select public.apply_finance_payable_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:second,movement_id:outgoing,amount_cents:100,method:'pix',reason:'Tentativa de usar saída já reservada'}])).rejects.toMatchObject({code:'23514'});await db.exec('rollback to savepoint excess');
 expect((await db.query<{n:number}>('select count(*)::int n from payables_payments where payable_id=$1',[second])).rows[0].n).toBe(0);
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);

it('records partial refunds and rejects stale, cross-tenant, replay changes and atomic faults',async()=>{const db=await createCustomerCreditRefundDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));const {credit,day}=await seedCustomerCreditRefundSource(db);
 const movement=(await db.query<{v:{movement_id:string}}>('select public.record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'refund',amount_cents:30000,occurred_on:day,description:'Devolução parcial registrada',beneficiary_name:'Crédito para previsão',beneficiary_document:'11222333000181',reason:'Documento de devolução parcial'}])).rows[0].v.movement_id;
 const ctx=async()=>(await db.query<{v:{revision:string,eligible:boolean}}>('select finance_private.customer_credit_refund_context($1,$2,$3,$4) v',[i.tenant,credit,movement,'10000'])).rows[0].v;
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,outgoing_movement_id:movement,amount_cents:'10000',expected_revision:(await ctx()).revision,reason:'Primeira parte da devolução real'};
 await db.query('select finance_private.record_customer_credit_refund($1)',[payload]);
 const fail=async(value:unknown,code:string)=>{await db.exec('savepoint denied');await expect(db.query('select finance_private.record_customer_credit_refund($1)',[value])).rejects.toMatchObject({code});await db.exec('rollback to savepoint denied');};
 await fail({...payload,request_id:randomUUID()},'40001');await fail({...payload,reason:'Não corresponde ao pedido original'},'23514');await fail({...payload,tenant_id:i.otherTenant},'42501');
 const next={...payload,request_id:randomUUID(),expected_revision:(await ctx()).revision};
 await db.exec('set constraints all immediate');await db.exec('set constraints all deferred');await db.exec('savepoint rollback_fault');await db.exec('alter table finance_private.customer_credit_refunds add constraint injected_failure check(false) not valid');await expect(db.query('select finance_private.record_customer_credit_refund($1)',[next])).rejects.toMatchObject({code:'23514'});await db.exec('rollback to savepoint rollback_fault');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_private.customer_credit_refunds')).rows[0].n).toBe(1);expect((await db.query<{n:number}>("select count(*)::int n from finance_events where action='customer_credit_refunded'")).rows[0].n).toBe(1);
 await db.query('select finance_private.record_customer_credit_refund($1)',[next]);expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v).toMatchObject({valid:true,returned_cents:'20000',available_cents:'40000'});
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}},30000);
