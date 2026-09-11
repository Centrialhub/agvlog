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

export async function runPaidProjectionsNative({query,contested,literal:q,createRoles=false}){
 const database='finance_paid_projections_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');await run(baseline.match(/CREATE TABLE public\.financial_obligations \([\s\S]*?\n\);/)[0]);await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8').match(/create or replace view finance_private\.active_payable_payments[\s\S]*?;/)[0]);const file='20260910172624_finance_paid_projection_chains.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência da cadeia exata do adiantamento'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),race=(a,b,opts={})=>contested(a,b,{database,driver:false,waiterSucceeds:false,...opts});
 async function seed(){const advance=randomUUID(),employee=randomUUID(),payable=randomUUID();await run(`${identity}insert into employees(id,tenant_id,name) values(${q(employee)},${q(i.tenant)},'Funcionário');insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,payable_id) values(${q(advance)},${q(i.tenant)},${q(employee)},50,'2026-08-01','paid',${q(payable)});insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(${q(payable)},${q(i.tenant)},'Funcionário','payroll',50,'approved','employee_advances',${q(advance)});`);return{advance,employee,payable};}
 async function pay(s,cents,day='2026-08-15',account=i.account){const movement=(await rpc('record_finance_movement',{...base(),bank_account_id:account,direction:'out',nature:'payment',amount_cents:cents,occurred_on:day,description:'Adiantamento',beneficiary_name:'Funcionário'})).movement_id;await rpc('apply_finance_payable_movement',{...base(),movement_id:movement,payable_id:s.payable,amount_cents:cents,method:'pix'});return movement;}
 const chain=async(id,table='employee_advances')=>JSON.parse(await run(`${identity}select finance_private.paid_projection_chain(${q(i.tenant)},${q(table)},${q(id)})`));
 const payroll=(s)=>{const period=randomUUID(),entry=randomUUID(),item=randomUUID();return{item,sql:`insert into payroll_periods(id,tenant_id,period_name,period_start,period_end,status) values(${q(period)},${q(i.tenant)},'Agosto','2026-08-01','2026-08-31','draft');insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,entry_type,status) values(${q(entry)},${q(i.tenant)},${q(period)},${q(s.employee)},'employee','draft');insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount,source_table,source_id) values(${q(item)},${q(i.tenant)},${q(period)},${q(entry)},${q(s.employee)},'advance','already_paid','Adiantamento já recebido',50,'employee_advances',${q(s.advance)});`};};
 let tests=0;const unpaid=await seed();assert.equal((await chain(unpaid.advance)).issue,'advance_not_fully_paid');tests++;console.log('PASS paid workflow without money stays unresolved');
 const s=await seed(),account=randomUUID();await run(`insert into bank_accounts(id,tenant_id,active) values(${q(account)},${q(i.tenant)},true)`);await pay(s,2000);await pay(s,3000,'2026-09-01',account);const c=await chain(s.advance);assert.equal(c.valid,true);assert.deepEqual(c.footprints.map(x=>x.account_id).sort(),[account,i.account].sort());assert.deepEqual(c.footprints.map(x=>x.occurred_on).sort(),['2026-08-15','2026-09-01']);const manifest=JSON.parse(await run(`${identity}select finance_private.legacy_cut_manifest(${q(i.tenant)},${q(i.account)},'2026-08-01','2026-08-31')`));assert.equal(manifest.sources.find(x=>x.source_id===s.advance).footprints.length,1);tests++;console.log('PASS split account/date resolved before period filtering');
 const p=payroll(s);await run(identity+p.sql);assert.equal((await chain(p.item,'payroll_entry_items')).valid,true);assert.equal(await run(`select finance_private.movement_used_cents(tenant_id,movement_id) from finance_payable_movement_links where payable_id=${q(s.payable)} order by amount_cents limit 1`),'2000');tests++;console.log('PASS payroll alias does not reserve outgoing capacity again');
 // Isolated historical frozen fixture: this does not claim the close RPC accepted an empty snapshot.
 const paid=await seed(),movement=await pay(paid,5000),opening=randomUUID(),closure=randomUUID(),request=randomUUID();
 const revokeSource=await seed(),revokeMovement=await pay(revokeSource,5000);
 const freeze=`${identity}select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0));insert into finance_account_openings(id,tenant_id,bank_account_id,effective_from,balance_cents,evidence_to,evidence,actor_id,actor_name,reason) values(${q(opening)},${q(i.tenant)},${q(i.account)},'2026-08-01',10000,'2026-08-31','{}',${q(i.operator)},'QA','Abertura histórica fixture');insert into finance_private.account_close_write_tickets values(txid_current(),${q(i.tenant)},${q(request)},${q(i.operator)},'finance_account_period_closures');insert into finance_account_period_closures(id,tenant_id,account_id,period_start,period_end,opening_id,snapshot,snapshot_revision,actor_id,actor_name,reason,request_id) values(${q(closure)},${q(i.tenant)},${q(i.account)},'2026-08-01','2026-08-31',${q(opening)},'{}',${q('a'.repeat(32))},${q(i.operator)},'QA','Fechamento histórico fixture',${q(request)});insert into finance_account_period_dependencies values(${q(i.tenant)},${q(closure)},'finance_movements',${q(movement)},'revision',${q(i.account)},'2026-08-01','2026-08-31','money');insert into finance_account_period_dependencies values(${q(i.tenant)},${q(closure)},'finance_movements',${q(revokeMovement)},'revision',${q(i.account)},'2026-08-01','2026-08-31','money');`;
 const raceResult=await race(freeze,`${identity}select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0));update employee_advances set amount=49 where id=${q(paid.advance)}`);assert.match(raceResult.error,/closed|concurrent/);assert.equal((await chain(paid.advance)).valid,true);tests++;console.log('PASS source alteration versus freeze is rejected without losing original');
 const late=payroll(paid),before=await run('select jsonb_agg(x order by id) from finance_movements x');await run(`begin;${identity}${late.sql}set constraints all immediate;commit;`);assert.equal((await chain(late.item,'payroll_entry_items')).valid,true);assert.equal(await run('select jsonb_agg(x order by id) from finance_movements x'),before);tests++;console.log('PASS late alias flush validates frozen movement without changing cash');
 const revoked=payroll(revokeSource);await assert.rejects(run(`begin;${identity}${revoked.sql}update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};set constraints all immediate;commit;`),/finance_access_denied/);assert.equal(await run(`select count(*) from payroll_entry_items where id=${q(revoked.item)}`),'0');tests++;console.log('PASS revoked author at deferred flush rolls back pending alias');
 const unsupported=payroll(unpaid);await assert.rejects(run(`begin;${identity}${unsupported.sql}set constraints all immediate;commit;`),/finance_account_period_closed/);assert.equal(await run(`select count(*) from payroll_entry_items where id=${q(unsupported.item)}`),'0');tests++;console.log('PASS paid without money cannot append a late payroll alias');
 const bypass=randomUUID();await assert.rejects(run(`${identity}insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,paid_at) values(${q(bypass)},${q(i.tenant)},${q(unpaid.employee)},50,'2026-08-01','approved','2026-08-15')`),/finance_account_period_closed/);assert.equal(await run(`select count(*) from employee_advances where id=${q(bypass)}`),'0');tests++;console.log('PASS approved advance with paid_at cannot bypass closed-source guard');
 return tests;
}
