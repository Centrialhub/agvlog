import {parseUnloadingProjectionRepairResult} from '../src/lib/financial/unloadingProjectionRepairCommandContract.ts';
import {unloadingProjectionRepairContextSchema} from '../src/lib/financial/unloadingProjectionRepairContract.ts';
import {periodUnloadingFlowSchema} from '../src/lib/financial/periodUnloadingFlowContract.ts';
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

export async function runPublicUnloadingRepairNative({query,contested,literal:q,createRoles=false}){
 const database='finance_public_unloading_repair_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
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


 const source=readFileSync('src/test/helpers/unloadingBankPackageDatabase.ts','utf8');let install=source.slice(source.indexOf('export async function createUnloadingBankPackageDatabase')).replace(/export async function createUnloadingBankPackageDatabase\([^)]*\)/,'async function installUnloading(installSourceGuard=false)').replace(' const db=await createPeriodMoneyPackageDatabase();','');await new Function('db','readFileSync',transpile(install)+';return installUnloading;')(db,readFileSync)();
 const helper=readFileSync('src/test/helpers/unloadingProjectionRepairDatabase.ts','utf8');let extra=helper.slice(helper.indexOf('export async function createUnloadingProjectionRepairDatabase'),helper.indexOf('export async function seedUnloadingRepairSource')).replace('export async function createUnloadingProjectionRepairDatabase()','async function installExtra()').replace(' const db=await createUnloadingBankPackageDatabase(false);','');await new Function('db','readFileSync',transpile(extra)+';return installExtra;')(db,readFileSync)();const seed=new Function('randomUUID','financeAs','i','readFileSync',transpile(helper.slice(helper.indexOf('export async function seedUnloadingRepairSource')))+';return seedUnloadingRepairSource;')(randomUUID,financeAs,i,readFileSync);
 const item=await seed(db,true);await run('update receivables set amount=180 where id='+q(item.receivable_id));
 for(const file of ['20260910205941_finance_unloading_receivable_source_guard.sql','20260910210433_finance_unloading_receivable_context.sql','20260910211156_finance_unloading_projection_repair.sql','20260910211740_finance_unloading_projection_repair_preview.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8'),hash=createHash('sha256').update(sql).digest('hex');if(file.includes('211156'))assert.equal(hash,'c0e71109be86c5f43bc799b506479c6fa7103e4db1b9a38b5a500c61fcd8f482');if(file.includes('211740'))assert.equal(hash,'df7590dceae582bddf72f86008a62de2f083d2c41642a2ec3993155b0abd9e25');await run(sql);console.log(file+' SHA256 '+hash);}

 const promotionFile='20260910212550_finance_public_unloading_projection_repair.sql',promotionSql=readFileSync('supabase/migrations/'+promotionFile,'utf8');assert.equal(createHash('sha256').update(promotionSql).digest('hex'),'0bbf8948dbbfe8bdfd4f5cbb157be6da61558d1a8387c1036038b619e0164d74');await run(promotionSql);console.log(promotionFile+' SHA256 '+createHash('sha256').update(promotionSql).digest('hex'));
 const preview=async()=>unloadingProjectionRepairContextSchema.parse(JSON.parse(await run(auth+'select get_finance_unloading_projection_repair_context('+q(i.tenant)+','+q(item.charge_id)+')')));const before=await preview();assert.equal(before.can_execute,true);
 const payload={...base(),charge_id:item.charge_id,revision:before.revision,reason:'Restauração confirmada pelo financeiro'};const execute=async()=>parseUnloadingProjectionRepairResult(JSON.parse(await run(call('repair_finance_unloading_projection',payload))),payload,i.operator,item.receivable_id);
 const original=await run("select jsonb_build_object('costs',(select jsonb_agg(to_jsonb(e) order by id) from finance_expense_items e),'payables',(select jsonb_agg(to_jsonb(p) order by id) from payables p),'money',(select count(*) from finance_movements))");const result=await execute();assert.deepEqual(await execute(),result);assert.equal(await run('select amount=150 from receivables where id='+q(item.receivable_id)),'t');assert.equal(await run('select count(*) from finance_unloading_projection_repairs'),'1');assert.equal(await run('select count(*) from finance_private.unloading_repair_tickets'),'0');assert.equal(await run("select jsonb_build_object('costs',(select jsonb_agg(to_jsonb(e) order by id) from finance_expense_items e),'payables',(select jsonb_agg(to_jsonb(p) order by id) from payables p),'money',(select count(*) from finance_movements))"),original);const after=await preview();assert.equal(after.history.length,1);assert.equal(after.can_execute,false);let passed=1;console.log('PASS authenticated public repair and replay with real result/context parsers; cost/payable/money unchanged');
 await assert.rejects(()=>run(auth+'select finance_private.repair_unloading_projection('+q(JSON.stringify(payload))+'::jsonb)'),/permission denied/);await assert.rejects(()=>run('set role anon;select repair_finance_unloading_projection('+q(JSON.stringify(payload))+'::jsonb)'),/permission denied/);passed++;console.log('PASS raw private writer and anonymous public access remain denied after promotion');
 const financeLock='select pg_advisory_xact_lock(hashtextextended('+q(i.tenant+':finance')+',0))';const revoked=await contested(financeLock,call('repair_finance_unloading_projection',payload),{database,driver:false,waiterSucceeds:false,holderAfterBlocked:'update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)});assert.match(revoked.error,/42501/);assert.match(revoked.error,/finance_access_denied/);assert.equal(await run('select count(*) from finance_unloading_projection_repairs'),'1');passed++;console.log('PASS public replay reauthorizes after finance wait and rejects revoked actor without new repair');return passed;
}
