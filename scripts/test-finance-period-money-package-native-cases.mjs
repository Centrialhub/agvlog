import {periodMoneyPackageSchema} from '../src/lib/financial/periodMoneyPackageContract.ts';
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

export async function runPeriodMoneyPackageNative({query,contested,literal:q,createRoles=false}){
 const database='finance_period_money_package_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');await run(baseline.match(/CREATE TABLE public\.financial_obligations \([\s\S]*?\n\);/)[0]);await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8').match(/create or replace view finance_private\.active_payable_payments[\s\S]*?;/)[0]);const file='20260910172624_finance_paid_projection_chains.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência da cadeia exata do adiantamento'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),race=(a,b,opts={})=>contested(a,b,{database,driver:false,waiterSucceeds:false,...opts});
 for(const file of ['20260910173906_finance_cash_period_closure.sql','20260910174142_finance_cash_period_count_readers.sql','20260910165830_finance_period_manual_audit.sql','20260910174822_finance_cash_period_manual_audit.sql','20260910175310_finance_cash_account_identity_scope.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 for(const file of ['20260910182541_finance_movement_correction_foundation.sql','20260910183438_finance_active_movement_period_projections.sql','20260910193723_finance_period_money_package.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');if(file.includes('193723'))assert.equal(createHash('sha256').update(sql).digest('hex'),'685ce9177c4e3b5202d7ac9e6eb13cd4f5963db001a14c16204b23290b624adf');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 for(const file of ['20260910033918_finance_internal_transfer_pairs.sql','20260910034731_finance_transfers_in_transit.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');for(const m of sql.matchAll(/create function [\s\S]*?\$\$;/gi))await run(m[0].replace(/^create function/i,'create or replace function'));for(const acl of sql.matchAll(/(?:revoke all on function|grant execute on function)[\s\S]*?;/gi))await run(acl[0]);}
 const paramsSql=(sql,params=[])=>sql.replace(/\$(\d+)/g,(_,n)=>{const v=params[Number(n)-1];return Array.isArray(v)?q('{'+v.join(',')+'}'):param(v);});
 const rows=async(sql,params=[],prefix=identity)=>{const body=paramsSql(sql,params);if(/^select/i.test(body.trim()))return {rows:JSON.parse(await run(`${prefix}select coalesce(json_agg(x),'[]') from (${body}) x`))};if(/returning/i.test(body))return {rows:JSON.parse(await run(`${prefix}with x as (${body}) select coalesce(json_agg(x),'[]') from x`))};await run(prefix+body);return {rows:[]};};
 db.query=(sql,params=[])=>rows(sql,params);const financeAs=(_db,actor,sql,params=[])=>rows(sql,params,`set request.jwt.claim.sub=${q(actor)};set role authenticated;`);
 const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('export ','');
 const seedSource=readFileSync('src/test/helpers/accountPeriodCloseDatabase.ts','utf8');const seedAccountCloseStatement=new Function('randomUUID','i',transpile(seedSource.slice(seedSource.indexOf('export async function seedAccountCloseStatement(')))+';return seedAccountCloseStatement;')(randomUUID,i);
 const cashSource=readFileSync('src/test/financePeriodMoneyPackage.test.ts','utf8'),bankSource=readFileSync('src/test/periodMoneyBankPackage.test.ts','utf8');const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};
 const cashFn=cashSource.slice(cashSource.indexOf('async function cashClosure('),cashSource.indexOf('async function secondAccount(')).replace('expect(p.blockers).toEqual([]);','assert.deepEqual(p.blockers,[]);');
 const bankFn=bankSource.slice(bankSource.indexOf('async function prepareBank('),bankSource.indexOf('async function read('));
 const historical=cashSource.slice(cashSource.indexOf('async function historicalSnapshot('),cashSource.indexOf("it.each([null,{}])"));
 const {cashClosure,prepareBank,historicalSnapshot}=new Function('db','financeAs','i','randomUUID','assert','rpc','base','scope','seedAccountCloseStatement',transpile(cashFn+bankFn+historical)+';return {cashClosure,prepareBank,historicalSnapshot};')(db,financeAs,i,randomUUID,assert,rpc,base,scope,seedAccountCloseStatement);
 const read=async(accounts,from='2026-01-01',to='2026-01-31')=>periodMoneyPackageSchema.parse(JSON.parse(await run(`${auth}select get_finance_period_money_package(${q(i.tenant)},${q(from)},${q(to)},${q('{'+accounts.join(',')+'}')}::uuid[])`)));
 const account=async()=>{const id=randomUUID();await run(`insert into bank_accounts(id,tenant_id,name,account_type,active) values(${q(id)},${q(i.tenant)},'Caixa QA','cash',true)`);return id;};let passed=0;
 const bank=await prepareBank(),cash=await account();await cashClosure(cash,5000,'2026-08-01','2026-08-31',5000);const mixed=await read([i.account,cash],'2026-08-01','2026-08-31');assert.equal(mixed.monetary_totals_valid,true);assert.equal(mixed.totals.in_cents,'1000');assert.equal(mixed.totals.closing_cents,'16000');assert.deepEqual(new Set(mixed.accounts.map(a=>a.closures[0].evidence_kind)),new Set(['cash_count','bank_statement']));passed++;console.log('PASS real bank reconciliation/coverage/closure + physical cash closure, no duplicate statement money');
 assert.equal((await read([i.account],'2026-08-02','2026-08-31')).monetary_totals_valid,false);const missing=await account();assert.equal((await read([i.account,missing],'2026-08-01','2026-08-31')).monetary_totals_valid,false);await rpc('reopen_finance_account_period',{...base(),closure_id:bank.closure_id,revision:bank.revision});assert.equal((await read([i.account],'2026-08-01','2026-08-31')).monetary_totals_valid,false);passed++;console.log('PASS exact-cut, missing account coverage and real reopening invalidate aggregate');
 const a=await account(),b=await account();await rpc('record_finance_internal_transfer',{...base(),source_account_id:a,destination_account_id:b,amount_cents:1000,debited_on:'2026-01-15',credited_on:'2026-01-15',both_recorded:true});await cashClosure(a,9000);await cashClosure(b,1000,'2026-01-01','2026-01-31',0);const pair=await read([a,b]);assert.equal(pair.transfers.length,1);assert.deepEqual(pair.totals,{opening_cents:'10000',in_cents:'1000',out_cents:'1000',closing_cents:'10000'});assert.equal(pair.transfer_totals.internal_pair_cents,'1000');assert.equal((await read([a])).transfers[0].classification,'scope_boundary_out');assert.equal((await read([b,a])).revision,pair.revision);passed++;console.log('PASS real transfer both legs eliminated once only in adjusted flows, boundary preserved');
 const transit=await account(),dest=await account(),dep=await rpc('record_finance_transfer_stage',{...base(),stage:'depart',source_account_id:transit,destination_account_id:dest,amount_cents:1000,occurred_on:'2026-01-30',occurred:true});await cashClosure(transit,9000);const before=await read([transit]);await rpc('record_finance_transfer_stage',{...base(),stage:'arrive',departure_id:dep.departure_id,occurred_on:'2026-02-02',occurred:true});const after=await read([transit]);assert.equal(before.transfers[0].classification,'in_transit');assert.equal(after.revision,before.revision);passed++;console.log('PASS frozen departure stays in transit after real later-period arrival');
 const monthly=await account();await cashClosure(monthly,10000);await cashClosure(monthly,10000,'2026-02-01','2026-02-28',null);assert.equal((await read([monthly],'2026-01-01','2026-02-28')).totals.opening_cents,'10000');passed++;console.log('PASS contiguous months use first opening and last closing');
 const damaged=await account(),closed=await cashClosure(damaged,10000);await historicalSnapshot(closed.closure_id,s=>{s.facts.transfers=null;});const malformed=await read([damaged]);assert.equal(malformed.monetary_totals_valid,true);assert.equal(malformed.transfer_classification_valid,false);assert.equal(malformed.totals.closing_cents,'10000');passed++;console.log('PASS malformed historical transfer metadata preserves proven gross money');
 const duplicate=await account();await rpc('record_finance_movement',{...base(),bank_account_id:duplicate,direction:'in',nature:'other',amount_cents:1000,occurred_on:'2026-01-02',description:'Entrada física',beneficiary_name:'Contraparte'});const dc=await cashClosure(duplicate,11000);await historicalSnapshot(dc.closure_id,s=>s.facts.movements.push({...s.facts.movements[0]}));const dr=await read([duplicate]);assert.equal(dr.monetary_totals_valid,false);assert.equal(dr.accounts[0].movement_ids.length,1);assert.ok(dr.accounts[0].issues.includes('duplicate_movement_manifest'));passed++;console.log('PASS duplicated historical movement diagnostics survive strict response schema');
 await assert.rejects(()=>read([a,a]),e=>String(e).includes('finance_duplicate_account_selection'));await assert.rejects(()=>read([i.otherAccount]),e=>String(e).includes('finance_account_not_found'));await run(`insert into tenant_memberships values(${q(i.tenant)},${q(i.operator)},'driver',true)`);await assert.rejects(()=>read([a]),e=>String(e).includes('finance_access_denied'));passed++;console.log('PASS duplicate selection, foreign account and mixed-driver isolation');
 return passed;
}
