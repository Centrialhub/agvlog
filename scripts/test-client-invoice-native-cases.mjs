import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installInvoiceLifecycleFixture,invoiceLifecycleSql} from '../src/test/helpers/clientInvoiceLifecycleDatabase.ts';
import {closingChargeFixtureIds as f} from '../src/test/helpers/closingLifecycleDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runClientInvoiceNative({query,session,finish,waitForMarker,contested,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`,api=operator+'set role authenticated;';
 const adapter={exec:query,query:async(sql,params=[])=>{const statement=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])).replace(/;\s*$/,'');return {rows:JSON.parse(await query(`with qa_result as (${statement}) select coalesce(json_agg(qa_result),'[]') from qa_result;`))};}};
 await installInvoiceLifecycleFixture(adapter);
 const bank='cf600000-0000-4000-8000-000000000001',day=await query("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD');");
 const draft=()=>({tenant_id:i.tenant,client_id:f.client,issue_date:day,due_date:null,discount_amount:0,interest_amount:0,notes:null,charges:[{source_type:'manual_service',description:'Serviço QA local',gross_amount:100,net_amount:100,sort_order:0}]});
 const creation=async body=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),action:'generate',reason:'Faturamento QA local',draft:body,
  expected_revision:JSON.parse(await query(`${api}select get_client_invoice_creation_context(${q(i.tenant)},null,${q(JSON.stringify(body))}::jsonb);`)).revision});
 const context=async invoice=>JSON.parse(await query(`${api}select get_client_invoice_action_context(${q(i.tenant)},${q(invoice)});`));
 const action=async(invoice,type='cancel')=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),action:type,invoice_id:invoice,reason:'Conferência QA local',expected_revision:(await context(invoice)).revision});
 const call=p=>`${api}select apply_client_invoice_command(${q(JSON.stringify(p))}::jsonb);`;
 const count=table=>query(`select count(*) from ${table};`);let invoice,receivable;
 const receipt=async()=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:receivable,action:'receive',reason:'Recebimento sintético QA',amount_cents:1000,effective_date:day,bank_account_id:bank,method:'pix',expected_revision:JSON.parse(await query(`${api}select get_receivable_financial_context(${q(i.tenant)},${q(receivable)});`)).revision});
 const held=async(winner,loser)=>{const holder=session('invoice-command-holder');holder.send('begin;'+winner+"select '__INVOICE_HELD__';");await waitForMarker(holder,'__INVOICE_HELD__');try{await assert.rejects(()=>query(loser),/40001.*concurrent_change/);}finally{await finish(holder,'commit;');}};
 const tests=[
  ['invoice migration preserves bank evidence and closes legacy invoice API access',async()=>{
   const before=await count('bank_transactions'),sql=invoiceLifecycleSql();await query('begin;'+sql+'commit;');assert.equal(await count('bank_transactions'),before);console.log('Client invoice candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   for(const fn of ['create_client_invoice(jsonb)','cancel_client_invoice(uuid,text)','generate_client_invoice_from_closing(uuid)','_invoice_lifecycle_snapshot(uuid,uuid)'])assert.equal(await query(`select has_function_privilege('authenticated',${q(fn)},'execute');`),'f');
  }],
  ['concurrent identical invoice generation returns one original invoice and one acknowledgement',async()=>{
   const p=await creation(draft()),before=Number(await count('client_invoices'));await contested(call(p),call(p),{driver:false});assert.equal(Number(await count('client_invoices')),before+1);const ack=JSON.parse(await query(call(p)));invoice=ack.invoice_id;receivable=ack.receivable_id;assert.equal((await context(invoice)).open_cents,10000);assert.equal(await count('client_invoice_commands'),'1');
  }],
  ['cancellation racing a receipt leaves no partial ledger mutation',async()=>{
   const cancel=await action(invoice),payment=await receipt(),before=await count('bank_transactions');await held(call(cancel),`${api}select apply_receivable_financial_command(${q(JSON.stringify(payment))}::jsonb);`);assert.equal((await context(invoice)).status,'cancelled');assert.equal(await count('bank_transactions'),before);
  }],
  ['concurrent identical reactivation retains one invoice with a single transition event',async()=>{
   const p=await action(invoice,'reactivate'),before=Number(await count('client_invoice_commands'));await contested(call(p),call(p),{driver:false});assert.equal((await context(invoice)).status,'generated');assert.equal(Number(await count('client_invoice_commands')),before+1);
  }],
  ['different action keys on the same invoice fail fast and preserve the winning cancellation',async()=>{
   const winner=await action(invoice),loser=await action(invoice);await held(call(winner),call(loser));assert.equal((await context(invoice)).status,'cancelled');await query(call(await action(invoice,'reactivate')));
  }],
  ['revoking membership while the request key is locked prevents invoice mutation',async()=>{
   const p=await action(invoice),lock=`select pg_advisory_xact_lock(hashtext('client-invoice-command'),hashtext(${q(i.tenant+':'+i.operator+':'+p.request_id)}))`;
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(result.error,/42501.*not_authorized/);}
   finally{await query(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);}assert.equal((await context(invoice)).status,'generated');
  }],
  ['late acknowledgement failure rolls back invoice, receivable and charge cancellation',async()=>{
   const p=await action(invoice),before=await count('client_invoice_commands');await query("create function qa_fail_invoice_ack() returns trigger language plpgsql as $$begin raise exception 'QA invoice acknowledgement failed';end;$$;create trigger qa_fail_invoice_ack before insert on client_invoice_commands for each row execute function qa_fail_invoice_ack();");
   try{await assert.rejects(()=>query(call(p)),/QA invoice acknowledgement failed/);}finally{await query('drop trigger qa_fail_invoice_ack on client_invoice_commands;drop function qa_fail_invoice_ack();');}assert.equal((await context(invoice)).status,'generated');assert.equal(await count('client_invoice_commands'),before);assert.equal(await query(`select count(*) from client_invoice_charges where invoice_id=${q(invoice)} and cancelled_at is not null;`),'0');
  }],
  ['two different invoices cannot claim the same CT-e concurrently',async()=>{
   const source=randomUUID();await query(`insert into cte_documents(id,tenant_id,client_id,cte_number,freight_value,status,sefaz_status,is_voided) values(${q(source)},${q(i.tenant)},${q(f.client)},'QA-INVOICE-RACE',100,'authorized','authorized',false);`);
   const body={...draft(),charges:[{source_type:'cte_document',source_id:source,gross_amount:100,net_amount:100,sort_order:0}]},winner=await creation(body),loser=await creation(body);await held(call(winner),call(loser));assert.equal(await query(`select count(*) from client_invoice_charges where source_id=${q(source)} and cancelled_at is null;`),'1');
  }],
  ['changed closing sources cannot be reactivated after balanced cancellation and bank history remains intact',async()=>{
   const linked=await query(`select client_invoice_id from closing_reports where client_id=${q(f.client)} and client_invoice_id is not null order by created_at desc limit 1;`),before=await count('bank_transactions');assert.ok(linked);await query(call(await action(linked)));assert.equal((await context(linked)).status,'cancelled');const reactivation=await action(linked,'reactivate');await assert.rejects(()=>query(call(reactivation)),/source|already_reserved|already_invoiced/);assert.equal(await count('bank_transactions'),before);assert.equal((await context(linked)).status,'cancelled');
  }],
  ['invoice history remains immutable and raw invoice rows are hidden from a driver',async()=>{
   await assert.rejects(()=>query(`update client_invoices set total_amount=1 where id=${q(invoice)};`),/55000.*invoice_contract_is_immutable/);await assert.rejects(()=>query(`delete from client_invoice_commands where invoice_id=${q(invoice)};`),/55000.*Closing creation acknowledgement is append-only/);
   await query(`update tenant_memberships set role='driver' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);try{assert.equal(await query(`${api}select count(*) from client_invoices;`),'0');await assert.rejects(()=>query(`${api}select list_client_invoice_financials(${q(i.tenant)});`),/not_authorized/);}finally{await query(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);}
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
