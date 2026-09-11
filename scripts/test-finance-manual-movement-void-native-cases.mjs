import {financeAuditSchema} from '../src/lib/financial/financeAuditContract.ts';
import {movementCorrectionPreviewSchema} from '../src/lib/financial/movementCorrectionPreviewContract.ts';
import ts from 'typescript';
import {z} from 'zod';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
async function prepareDatabase(db,guards = true) {

    await db.exec(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'checking';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
create function finance_private.can_read_receipt(_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if split_part(_path,'/',1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;end if;
 return finance_private.can_access(split_part(_path,'/',1)::uuid);
end;$$;`);
    const baseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8');
    for (const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))
        await db.exec(type[0]);
    // Baseline monetary source schemas, without unrelated FK graph. Source writers
    // and external storage authenticity need separate full-platform verification.
    for (const table of ['bank_transactions', 'receivables', 'receivables_payments', 'payables', 'payables_payments', 'driver_settlement_payments', 'closing_report_payments', 'load_payments', 'employee_advances', 'payroll_entry_items']) {
        const create = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
        if (!create)
            throw new Error(table);
        await db.exec(create);
        const defaults = baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];
        if (defaults)
            await db.exec(defaults);
        await db.exec(`alter table ${table} add primary key(id)`);
    }
    for (const table of ['bank_accounts', 'bank_transactions', 'receivables', 'receivables_payments'])
        await db.exec(`alter table ${table} add unique(tenant_id,id)`);
    const financial = readFileSync('supabase/migrations/20260830183929_audit_receivable_payments_and_reversals.sql', 'utf8');
    for (const table of ['receivable_financial_commands', 'receivable_payment_reversals']) {
        const ddl = financial.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`, 'i'))?.[0];
        if (!ddl)
            throw new Error(table);
        await db.exec(ddl);
    }
    for (const name of ['20260909222851_finance_statement_intake', '20260909223737_finance_statement_source_verification', '20260909230507_finance_statement_queries', '20260909231643_finance_statement_identity_review', '20260909233625_finance_audit_queries', '20260910013543_finance_bank_reconciliation_groups', '20260910015331_finance_reconciliation_history', '20260910020543_finance_ofx_statement_intake', '20260910021404_finance_native_statement_account', '20260910022059_finance_automatic_reference_reconciliation', '20260910023911_finance_account_period_review', '20260910033918_finance_internal_transfer_pairs', '20260910034731_finance_transfers_in_transit', '20260910130956_finance_statement_period_evidence', '20260910140010_finance_account_opening_balances', '20260910141240_finance_cash_opening_counts', '20260910142143_finance_statement_coverage_approvals', '20260910162807_finance_account_period_closure_foundation', '20260910162958_finance_account_period_close_snapshot'])
        await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
    if (guards) {
        for (const table of ['driver_settlements', 'closing_reports', 'loads', 'employees', 'payroll_entries', 'payroll_periods', 'bank_statement_imports']) {
            const create = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
            if (!create)
                throw new Error(table);
            await db.exec(create);
            const defaults = baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];
            if (defaults)
                await db.exec(defaults);
            await db.exec(`alter table ${table} add primary key(id)`);
        }
        await db.exec('alter table closing_report_payments add column canonical_receivable_payment_id uuid;alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;alter table receivables_payments add column financial_command_id uuid');
        for (const [file, table] of [
            ['20260910025658_finance_receipt_allocation_corrections', 'finance_receipt_allocation_corrections'], ['20260910024438_finance_receivable_movement_projection', 'finance_receivable_movement_links'], ['20260910002244_finance_payable_movement_links', 'finance_payable_movement_links'], ['20260910003529_finance_payable_link_reversal', 'finance_payable_link_reversals'], ['20260910130540_finance_settlement_movement_links', 'finance_settlement_movement_links'], ['20260910132411_finance_settlement_link_reversals', 'finance_settlement_link_reversals'], ['20260910145616_finance_legacy_receipt_associations', 'finance_legacy_receipt_movement_links'], ['20260910145616_finance_legacy_receipt_associations', 'finance_legacy_receipt_link_reversals'], ['20260909212514_finance_delivery_unloading', 'finance_unloading_charges'], ['20260909213959_finance_expense_batches', 'finance_expense_batches'], ['20260909213959_finance_expense_batches', 'finance_expense_items'], ['20260909213959_finance_expense_batches', 'finance_expense_allocations']
        ]) {
            const sql = readFileSync(`supabase/migrations/${file}.sql`, 'utf8');
            let ddl = sql.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`, 'i'))?.[0];
            if (!ddl)
                throw new Error(table);
            ddl = ddl.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi, '').replace(/ references public\.\w+\([^)]*\)/g, '');
            await db.exec(ddl);
        }
        await db.exec(readFileSync('supabase/migrations/20260909220941_finance_receipt_evidence.sql', 'utf8').replace('create function finance_private.can_read_receipt', 'create or replace function finance_private.can_read_receipt'));
        for (const name of ['20260910151011_finance_legacy_integrity_inventory', '20260910163109_finance_account_period_closed_source_guards', '20260910163116_finance_legacy_cut_reviews', '20260910164923_finance_account_period_closure_evidence', '20260910170213_finance_legacy_cut_settlement_mapping'])
            await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
    }
    return db;
}

async function prepareLateComposition(db) {

    const read = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
    const expense = read('20260909213959_finance_expense_batches').match(/create table public\.finance_expense_allocations\s*\([\s\S]*?\n\);/)?.[0];
    if (!expense)
        throw new Error('allocations');

    await db.exec("alter table finance_payable_movement_links add column if not exists origin text not null default 'canonical'");
    for (const [file, name] of [['20260910132411_finance_settlement_link_reversals', 'movement_used_cents'], ['20260910145616_finance_legacy_receipt_associations', 'receipt_movement_used_cents'], ['20260910002244_finance_payable_movement_links', 'apply_payable_movement']]) {
        const sql = read(file);
        const start = sql.indexOf(`function finance_private.${name}(`);
        if (start < 0)
            throw new Error(name);
        const prefix = sql.lastIndexOf('create', start);
        await db.exec(sql.slice(prefix, sql.indexOf('$$;', start) + 3));
    }
    await db.exec("grant execute on function finance_private.apply_payable_movement(jsonb) to authenticated;create function public.apply_finance_payable_movement(_payload jsonb) returns jsonb language sql security invoker as $$select finance_private.apply_payable_movement(_payload)$$;grant execute on function public.apply_finance_payable_movement(jsonb) to authenticated");
    await db.exec(read('20260910164942_finance_closed_period_late_payment_composition'));
    return db;
}

export async function runManualMovementVoidNative({query,contested,literal:q,createRoles=false}){
 const database='finance_manual_movement_void_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');await run(baseline.match(/CREATE TABLE public\.financial_obligations \([\s\S]*?\n\);/)[0]);await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8').match(/create or replace view finance_private\.active_payable_payments[\s\S]*?;/)[0]);const file='20260910172624_finance_paid_projection_chains.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência da cadeia exata do adiantamento'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),race=(a,b,opts={})=>contested(a,b,{database,driver:false,waiterSucceeds:false,...opts});
 for(const file of ['20260910173906_finance_cash_period_closure.sql','20260910174142_finance_cash_period_count_readers.sql','20260910165830_finance_period_manual_audit.sql','20260910174822_finance_cash_period_manual_audit.sql','20260910175310_finance_cash_account_identity_scope.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 // Reuse the real cash/period/paid-chain graph. Extend it with the same current
 // factory bodies after their base factory calls; no alternate success helpers.
 db.query=async(sql,params=[])=>{const text=sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1]));return {rows:JSON.parse(await run(`select coalesce(json_agg(qa),'[]') from (${text}) qa`))};};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const [file,marker] of [['voidAwareMonetaryProofDatabase','const db=await createCashPeriodCloseDatabase();'],['movementCorrectionContextDatabase','const db=await createVoidAwareMonetaryProofDatabase();']]){
  const source=readFileSync(`src/test/helpers/${file}.ts`,'utf8');const start=source.indexOf(marker);assert.ok(start>=0,file);const body=source.slice(start+marker.length,source.lastIndexOf('return db;'));
  const js=ts.transpileModule(`async function extend(db){${body}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const begin=js.indexOf('{')+1;await new AsyncFunction('db','readFileSync',js.slice(begin,js.lastIndexOf('}')))(db,readFileSync);
 }
 const previewFile='20260910190635_finance_movement_correction_preview.sql';await run(readFileSync('supabase/migrations/'+previewFile,'utf8'));
 for(const file of ['20260910190516_finance_movement_correction_context.sql',previewFile])console.log(file+' SHA256 '+createHash('sha256').update(readFileSync('supabase/migrations/'+file)).digest('hex'));
 const writer=readFileSync('supabase/migrations/20260910191905_finance_manual_movement_void_command.sql','utf8');assert.equal(createHash('sha256').update(writer).digest('hex'),'6f57f662c965f24ccc010973232ea16b9ed44d0eed8480f0a47a72524237039b');await run(writer);console.log('191905 SHA256 '+createHash('sha256').update(writer).digest('hex'));
 const setup=async(direction='out')=>{const original=randomUUID(),r=await rpc('record_finance_movement',{version:1,tenant_id:i.tenant,request_id:original,bank_account_id:i.account,direction,nature:'other',amount_cents:5000,occurred_on:'2026-08-15',description:'Registro para conferir',beneficiary_name:'Fornecedor QA',reason:'Registro original para correção'});const revision=await run(`${identity}select finance_private.movement_correction_context(${q(i.tenant)},${q(r.movement_id)})->>'revision'`);return{id:r.movement_id,payload:{version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_id:r.movement_id,revision,reason:'Representação registrada por engano e conferida'}};};
 const command=f=>`${identity}select finance_private.void_manual_movement(${q(JSON.stringify(f.payload))}::jsonb)`;
 const lock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant)}::text||':finance',0));`;
 const reject=async(sql,error)=>assert.rejects(()=>run(sql),e=>String(e).includes(error));
 let passed=0;
 const f=await setup(),before=await run(`select to_jsonb(m) from finance_movements m where id=${q(f.id)}`),result=JSON.parse(await run(command(f)));assert.equal(result.bank_money_transacted,false);assert.deepEqual(JSON.parse(await run(command(f))),result);assert.equal(await run(`select to_jsonb(m) from finance_movements m where id=${q(f.id)}`),before);assert.equal(await run('select count(*) from finance_private.movement_void_write_tickets'),'0');
 const audit=financeAuditSchema.parse(JSON.parse(await run(`${identity}select finance_private.audit_events(${q(i.tenant)},'{"page":1,"page_size":30,"manual_only":true,"action":"movement_voided"}')`)));assert.equal(audit.total,1);assert.equal(audit.rows[0].actor_id,i.operator);passed++;console.log('PASS private command success/replay/manual audit, original money intact');
 const revoke=await race(`${lock}update tenant_memberships set active=false where user_id=${q(i.operator)}`,command(f));assert.match(revoke.error,/42501/);assert.match(revoke.error,/finance_access_denied/);await run(`update tenant_memberships set active=true where user_id=${q(i.operator)}`);passed++;console.log('PASS revocation during finance wait blocks replay');
 const busy=await setup();const busyResult=await race(`select 1 from finance_movements where id=${q(busy.id)} for update`,command(busy),{waitForBlocking:false});assert.match(busyResult.error,/40001/);assert.match(busyResult.error,/finance_movement_correction_busy/);assert.equal(await run(`select count(*) from finance_movement_voids where movement_id=${q(busy.id)}`),'0');passed++;console.log('PASS NOWAIT row-first40001 without deadlock or partial void');
 for(const kind of ['payable','transfer','departure']){
  const source=await setup(),incoming=await setup('in'),title=randomUUID();
  const insert=kind==='payable'?`insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(${q(title)},${q(i.tenant)},'Fornecedor','other',50,'approved','finance_movements',${q(source.id)})`:kind==='transfer'?`insert into finance_internal_transfers(tenant_id,outgoing_id,incoming_id,created_by) values(${q(i.tenant)},${q(source.id)},${q(incoming.id)},${q(i.operator)})`:`insert into finance_transfer_departures(tenant_id,outgoing_id,destination_account_id,created_by) values(${q(i.tenant)},${q(source.id)},${q(i.account)},${q(i.operator)})`;
  const first=await race(`${identity}${insert}`,command(source));assert.match(first.error,/finance_movement_correction_changed/);assert.equal(await run(`select count(*) from finance_movement_voids where movement_id=${q(source.id)}`),'0');
  const free=await setup();const afterInsert=insert.replaceAll(source.id,free.id).replaceAll(title,randomUUID());const second=await race(command(free),`${identity}${afterInsert}`,{waitForBlocking:false});assert.match(second.error,/40001/);await reject(`${identity}${afterInsert}`,'finance_movement_voided');passed++;console.log('PASS void versus '+kind+' both orders, no new dependent after void');
 }
 const cost=await setup(),batch=randomUUID(),expense=randomUUID();await run(`insert into finance_expense_batches(id,tenant_id,context,description,created_by) values(${q(batch)},${q(i.tenant)},'office','Fixture custo',${q(i.operator)});insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) values(${q(expense)},${q(i.tenant)},${q(batch)},'office','Fixture custo',1000,'2026-08-15','Fornecedor','Recibo indisponível na fixture',${q(i.operator)})`);
 const allocation=`${identity}insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values(${q(i.tenant)},${q(expense)},${q(cost.id)},1000,${q(i.operator)})`;
 const allocationFirst=await race(allocation,command(cost));assert.match(allocationFirst.error,/finance_movement_correction_changed/);assert.equal(await run(`select sum(amount_cents) from finance_expense_allocations where movement_id=${q(cost.id)}`),'1000');passed++;console.log('PASS allocation wins against waiting void, cost/money preserved');
 const freshCost=await setup(),secondAllocation=allocation.replaceAll(cost.id,freshCost.id);const voidFirst=await race(command(freshCost),secondAllocation,{waitForBlocking:false});assert.match(voidFirst.error,/40001/);await reject(secondAllocation,'finance_movement_voided');assert.equal(await run(`select count(*) from finance_expense_allocations where movement_id=${q(freshCost.id)}`),'0');passed++;console.log('PASS void command wins against residual allocation, no partial cost link');
 return passed;
}
