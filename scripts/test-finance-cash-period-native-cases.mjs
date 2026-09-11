import ts from 'typescript';
import {financeAuditSchema} from '../src/lib/financial/financeAuditContract.ts';
import {z} from 'zod';
import {cashCountsSchema} from '../src/lib/financial/cashOpeningContract.ts';
import {accountPeriodReopenCommandSchema} from '../src/lib/financial/accountPeriodCloseContract.ts';
import {accountPeriodEvidenceSchema} from '../src/lib/financial/accountPeriodEvidenceContract.ts';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
import {legacyCutReviewSchema} from '../src/lib/financial/legacyCutReviewContract.ts';
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

export async function runCashPeriodNative({query,contested,literal:q,createRoles=false}){
 const database='finance_cash_period_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');await run(baseline.match(/CREATE TABLE public\.financial_obligations \([\s\S]*?\n\);/)[0]);await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8').match(/create or replace view finance_private\.active_payable_payments[\s\S]*?;/)[0]);const file='20260910172624_finance_paid_projection_chains.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência da cadeia exata do adiantamento'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),race=(a,b,opts={})=>contested(a,b,{database,driver:false,waiterSucceeds:false,...opts});
 for(const file of ['20260910173906_finance_cash_period_closure.sql','20260910174142_finance_cash_period_count_readers.sql','20260910165830_finance_period_manual_audit.sql','20260910174822_finance_cash_period_manual_audit.sql','20260910175310_finance_cash_account_identity_scope.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 const contract=ts.transpileModule(readFileSync('src/lib/financial/cashPeriodContract.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\r?\n/gm,'').replaceAll('export const ','const ');const schemas=new Function('z','cashCountsSchema','accountPeriodReopenCommandSchema',contract+';return {cashPeriodPreviewSchema,cashPeriodCountsSchema,cashPeriodCloseResultSchema,cashPeriodCountResultSchema}')(z,cashCountsSchema,accountPeriodReopenCommandSchema);
 async function account(cents=10000){const id=randomUUID();await run(`insert into bank_accounts(id,tenant_id,active,account_type,bank_code,branch_number,account_number) values(${q(id)},${q(i.tenant)},true,'cash',null,null,null)`);await rpc('record_finance_cash_opening',{...base(),account_id:id,effective_from:'2026-01-01',custodian_name:'Responsável QA',counts:[{denomination_cents:1,quantity:cents}]});return id;}
 const movementPayload=(account,direction,cents,day='2026-01-02')=>({...base(),bank_account_id:account,direction,nature:'other',amount_cents:cents,occurred_on:day,description:'Movimento físico do caixa',beneficiary_name:'Responsável'});
 const money=async(...args)=>rpc('record_finance_movement',movementPayload(...args));
 const countPayload=(account,cents,end='2026-01-31')=>({...base(),account_id:account,period_end:end,counts:[{denomination_cents:1,quantity:cents}],custodian_name:'Responsável QA',counted_at_boundary:'end_of_day'});
 const count=async(...args)=>schemas.cashPeriodCountResultSchema.parse(await rpc('record_finance_cash_period_count',countPayload(...args)));
 async function review(account,from='2026-01-01',to='2026-01-31'){const p=JSON.parse(await run(`${auth}select get_finance_legacy_cut_review(${q(i.tenant)},${q(account)},${q(from)},${q(to)})`));await rpc('review_finance_legacy_cut',{...base(),account_id:account,from,to,revision:p.revision,sources_reviewed:true});}
 const preview=async(account,id,from='2026-01-01',to='2026-01-31')=>schemas.cashPeriodPreviewSchema.parse(JSON.parse(await run(`${auth}select preview_finance_cash_period_close(${q(i.tenant)},${q(account)},${q(from)},${q(to)},${q(id)})`)));
 const closePayload=async(account,id,from='2026-01-01',to='2026-01-31')=>({...base(),account_id:account,from,to,count_id:id,revision:(await preview(account,id,from,to)).revision});
 const close=async(...args)=>schemas.cashPeriodCloseResultSchema.parse(await rpc('close_finance_cash_period',await closePayload(...args)));
 const reversePayload=c=>({...base(),count_id:c.count_id,revision:c.revision});
 const reopen=async c=>rpc('reopen_finance_account_period',{...base(),closure_id:c.closure_id,revision:c.revision});
 const history=async(a,end='2026-01-31')=>schemas.cashPeriodCountsSchema.parse(JSON.parse(await run(`${auth}select get_finance_cash_period_counts(${q(i.tenant)},${q(a)},${q(end)},1)`)));
 let tests=0;
 {const a=await account(),employee=randomUUID(),advance=randomUUID(),payable=randomUUID();await run(`${identity}insert into employees(id,tenant_id,name) values(${q(employee)},${q(i.tenant)},'Funcionário');insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,payable_id) values(${q(advance)},${q(i.tenant)},${q(employee)},50,'2026-01-01','paid',${q(payable)});insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(${q(payable)},${q(i.tenant)},'Funcionário','payroll',50,'approved','employee_advances',${q(advance)})`);for(const [acc,cents] of [[a,2000],[i.account,3000]]){const m=await rpc('record_finance_movement',{...movementPayload(acc,'out',cents),nature:'payment'});await rpc('apply_finance_payable_movement',{...base(),movement_id:m.movement_id,payable_id:payable,amount_cents:cents,method:'other'});}const c=await count(a,8000);await review(a);assert.equal((await preview(a,c.count_id)).balances.expected_closing_cents,'8000');await close(a,c.count_id);tests++;console.log('PASS real cash and bank advance footprints close only physical leg');}
 {const a=await account();await rpc('record_finance_internal_transfer',{...base(),source_account_id:i.account,destination_account_id:a,amount_cents:2000,debited_on:'2026-01-02',credited_on:'2026-01-03',both_recorded:true});const c=await count(a,12000);await review(a);assert.equal((await preview(a,c.count_id)).balances.in_cents,'2000');await close(a,c.count_id);tests++;console.log('PASS real bank-to-cash transfer retains two money legs without extra revenue');}

 {const a=await account();await money(a,'in',1000);await money(a,'out',2500);const c=await count(a,8500);await review(a);assert.equal((await preview(a,c.count_id)).eligible,true);const closed=await close(a,c.count_id);const evidence=()=>run(`${auth}select get_finance_account_period_evidence(${q(i.tenant)},${q(a)},${q(closed.closure_id)})`);const e=accountPeriodEvidenceSchema.parse(JSON.parse(await evidence()));assert.deepEqual(e.integrity,{snapshot_matches_revision:true,dependencies_match:true});assert.equal(e.snapshot.evidence_type,'cash_count_v1');assert.equal((await history(a)).rows[0].can_reverse,false);await reopen(closed);assert.deepEqual(accountPeriodEvidenceSchema.parse(JSON.parse(await evidence())).snapshot,e.snapshot);assert.equal(await run('select count(*) from finance_bank_entries'),'0');tests++;console.log('PASS real cash close/evidence/reopen with no bank evidence');}
 {const a=await account(),c=await count(a,9500);await review(a);assert.equal((await preview(a,c.count_id)).balances.difference_cents,'-500');await assert.rejects(close(a,c.count_id),/blocked/);await rpc('reverse_finance_cash_period_count',reversePayload(c));const next=await count(a,10500);assert.equal((await preview(a,next.count_id)).balances.difference_cents,'500');await assert.rejects(close(a,next.count_id),/blocked/);const h=await history(a);assert.equal(h.total,2);assert.equal(h.rows.filter(x=>x.reversal).length,1);tests++;console.log('PASS shortage/surplus permanent history without forced adjustment');}
 {const a=await account(0),c=await count(a,0);await review(a);const p=await closePayload(a,c.count_id);const r=await race(call('close_finance_cash_period',p),call('record_finance_movement',movementPayload(a,'in',100)));assert.match(r.error,/closed/);await assert.rejects(rpc('reverse_finance_cash_period_count',reversePayload(c)),/closed/);tests++;console.log('PASS zero cash real close wins race against new retroactive money');}
 {const a=await account(),c=await count(a,10000);await review(a);const p=await closePayload(a,c.count_id);const r=await race(call('reverse_finance_cash_period_count',reversePayload(c)),call('close_finance_cash_period',p));assert.match(r.error,/changed|blocked/);assert.equal(await run(`select count(*) from finance_account_period_closures where account_id=${q(a)}`),'0');tests++;console.log('PASS count reversal wins race and old close is rejected');}
 {const a=await account(),c=await count(a,10000);await review(a);const first=await close(a,c.count_id),next=await count(a,10000,'2026-02-28');await review(a,'2026-02-01','2026-02-28');await close(a,next.count_id,'2026-02-01','2026-02-28');await assert.rejects(reopen(first),/descendants/);tests++;console.log('PASS contiguous cash successor blocks reopening predecessor');}
 {const a=await account(),p=countPayload(a,10000);await race(call('record_finance_cash_period_count',p),call('record_finance_cash_period_count',p),{waiterSucceeds:true});assert.equal((await history(a)).total,1);const c=(await history(a)).rows[0];await review(a);const closeCmd=await closePayload(a,c.id);const r=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,call('close_finance_cash_period',closeCmd),{holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/access_denied/);await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);tests++;console.log('PASS concurrent count replay and revoked closer after wait');}
 await assert.rejects(run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;select get_finance_cash_period_counts(${q(i.tenant)},${q(i.account)},'2026-01-31',1)`),/access_denied/);await assert.rejects(count(i.account,100),/cash_account_required/);tests++;console.log('PASS driver reader rejected and bank account cannot masquerade as physical cash');
 for(const action of ['cash_period_count_recorded','cash_period_count_reversed','cash_period_closed','account_period_reopened']){const audit=financeAuditSchema.parse(JSON.parse(await run(`${auth}select list_finance_audit_events(${q(i.tenant)},${q(JSON.stringify({manual_only:true,action}))}::jsonb)`)));assert.ok(audit.total>0,action);assert.ok(audit.rows.every(x=>x.manual_intervention));}tests++;console.log('PASS cash count/close/reopen events stay visible in manual-only audit');
 return tests;
}
