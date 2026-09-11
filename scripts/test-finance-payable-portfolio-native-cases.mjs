import {payablePortfolioSchema} from '../src/lib/financial/payablePortfolioContract.ts';
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

export async function runPayablePortfolioNative({query,contested,literal:q,createRoles=false}){
 const database='finance_payable_portfolio_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');await run(baseline.match(/CREATE TABLE public\.financial_obligations \([\s\S]*?\n\);/)[0]);await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8').match(/create or replace view finance_private\.active_payable_payments[\s\S]*?;/)[0]);const file='20260910172624_finance_paid_projection_chains.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência da cadeia exata do adiantamento'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),race=(a,b,opts={})=>contested(a,b,{database,driver:false,waiterSucceeds:false,...opts});
 async function seed(){const advance=randomUUID(),employee=randomUUID(),payable=randomUUID();await run(`${identity}insert into employees(id,tenant_id,name) values(${q(employee)},${q(i.tenant)},'Funcionário');insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,payable_id) values(${q(advance)},${q(i.tenant)},${q(employee)},50,'2026-08-01','paid',${q(payable)});insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(${q(payable)},${q(i.tenant)},'Funcionário','payroll',50,'approved','employee_advances',${q(advance)});`);return{advance,employee,payable};}
 async function pay(s,cents,day='2026-08-15',account=i.account){const movement=(await rpc('record_finance_movement',{...base(),bank_account_id:account,direction:'out',nature:'payment',amount_cents:cents,occurred_on:day,description:'Adiantamento',beneficiary_name:'Funcionário'})).movement_id;await rpc('apply_finance_payable_movement',{...base(),movement_id:movement,payable_id:s.payable,amount_cents:cents,method:'pix'});return movement;}
 const migration=readFileSync('supabase/migrations/20260910180040_finance_payable_portfolio.sql','utf8');await run(migration);console.log('180040 SHA256 '+createHash('sha256').update(migration).digest('hex'));const recalc=baseline.match(/CREATE OR REPLACE FUNCTION public\._recalc_payable_paid\([\s\S]*?\$function\$;/)[0];await run(recalc);await run('create trigger qa_recalc_payable after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid()');const rev=readFileSync('supabase/migrations/20260910003529_finance_payable_link_reversal.sql','utf8');await run(rev.slice(rev.indexOf('create function finance_private.reverse_payable_link'),rev.indexOf('create function finance_private.payable_payment_history')));
 const read=async(filters={},page=1,revision=null)=>payablePortfolioSchema.parse(JSON.parse(await run(`${auth}select get_finance_payable_portfolio(${q(i.tenant)},${q(JSON.stringify(filters))}::jsonb,${page},${revision===null?'null':q(revision)})`)));
 await run(`insert into payables(tenant_id,supplier_name,category,amount,status,due_date) select ${q(i.tenant)},'Fornecedor','other',1,'approved','2026-01-15' from generate_series(1,1005)`);const p=await read();assert.equal(p.total_titles,1005);assert.equal(p.nominal_cents,'100500');assert.equal((await read({},34,p.revision)).rows.length,15);console.log('PASS1005 integral titles and same-revision detail pages');
 // Full CTE body, not merely the function-call wrapper.
 let body=migration.slice(migration.indexOf(' with selected as materialized('),migration.indexOf(" if _revision is not null and result"));body=body.replace(' into result from summary',' from summary');
 const explain=body.replace(/\b_tenant\b/g,q(i.tenant)).replace(/\bbasis\b/g,"'due_date'").replace(/\bstarts\b/g,'null::date').replace(/\bends\b/g,'null::date').replace(/\bsupplier\b/g,'null::uuid').replace(/\bfilter_category\b/g,'null::text').replace(/\btoday\b/g,"date '2026-09-10'").replace(/\b_page\b/g,'1');
 // Avoid replacing literal envelope keys: the substitutions above only target variables except basis.
 const fixed=explain.replaceAll("''due_date''","'basis'");console.log('FULL_BODY_PLAN '+await run(identity+'explain(analyze,buffers,format json) '+fixed));
 const s=await seed();await pay(s,2000);const actual=await read();assert.equal(actual.paid_cents,'2000');assert.equal(actual.open_cents,'103500');const link=await run(`select id from finance_payable_movement_links where payable_id=${q(s.payable)}`);await rpc('reverse_finance_payable_link',{...base(),link_id:link});assert.equal((await read()).paid_cents,'0');await assert.rejects(read({},2,actual.revision),/portfolio_changed/);console.log('PASS real partial/reversal and stale-page rejection');
 await run(`update payables set status='paid' where id=${q(s.payable)}`);const invalid=await read();assert.equal(invalid.totals_valid,false);assert.equal(invalid.nominal_cents,null);await assert.rejects(run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;select get_finance_payable_portfolio(${q(i.tenant)})`),/access_denied/);console.log('PASS paid status without money is not silently totalized and driver is denied');return 3;
}
