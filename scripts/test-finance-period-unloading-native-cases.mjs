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

export async function runPeriodUnloadingNative({query,contested,literal:q,createRoles=false}){
 const database='finance_period_unloading_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
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

 const frozen=readFileSync('supabase/migrations/20260910203516_finance_period_unloading_flow.sql','utf8');assert.equal(createHash('sha256').update(frozen).digest('hex'),'12b288b8809da09d3dda8e3ee2c323b32e4defcc5650af25b6cc915ba436a2ae');
 const factory=readFileSync('src/test/helpers/unloadingBankPackageDatabase.ts','utf8'),start=factory.indexOf('export async function createUnloadingBankPackageDatabase()');const installBody=factory.slice(start).replace('export async function createUnloadingBankPackageDatabase()','async function installUnloading()').replace(' const db=await createPeriodMoneyPackageDatabase();','');
 await new Function('db','readFileSync',transpile(installBody)+';return installUnloading;')(db,readFileSync)();console.log('203516 SHA256 '+createHash('sha256').update(frozen).digest('hex'));
 const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};
 const rpcArgs=async(name,args)=>{const result=await financeAs(db,i.operator,'select '+name+'('+args.map((_,n)=>'$'+(n+1)).join(',')+') v',args);return result.rows[0].v;};
 const source=readFileSync('src/test/periodUnloadingBankPackage.test.ts','utf8');const helpers=source.slice(source.indexOf('async function receive('),source.indexOf("it('links")).replace('expect(context.issue).toBeNull();','assert.equal(context.issue,null);');
 const helperFns=new Function('db','i','randomUUID','rpc','base','assert',transpile(helpers)+';return {charge,receive};')(db,i,randomUUID,rpcArgs,base,assert);
 const read=async()=>periodUnloadingFlowSchema.parse(await rpcArgs('get_finance_period_unloading_flow',[i.tenant,scope.from,scope.to,[i.account],null,1,null]));
 let body=source.slice(source.indexOf(' const origin=await charge();'),source.indexOf(' const read=async()=>'));body=body.replace('await receive(freight,20000,movement.movement_id);',
 'await receive(freight,15000,movement.movement_id);const claimBefore=await read();await receive(freight,5000,movement.movement_id);const claimAfter=await read();assert.notEqual(claimAfter.revision,claimBefore.revision);assert.equal(claimAfter.receipt_totals.amount_cents,claimBefore.receipt_totals.amount_cents);');
 const closedState=await new Function('db','i','rpc','base','scope','seedAccountCloseStatement','charge','receive','assert','read',transpile('async function scenario(){'+body+'return {origin,movement,closed};}')+';return scenario;')(db,i,rpcArgs,base,scope,seedAccountCloseStatement,helperFns.charge,helperFns.receive,assert,read)();
 const {closed,movement}=closedState,money=periodMoneyPackageSchema.parse(await rpcArgs('get_finance_period_money_package',[i.tenant,scope.from,scope.to,[i.account]])),flow=await read();assert.equal(flow.money_package_revision,money.revision);assert.equal(money.totals.in_cents,'30000');assert.equal(flow.origin_totals.amount_cents,'15000');assert.equal(flow.receipt_totals.amount_cents,'10000');assert.equal(flow.money_links.length,1);assert.deepEqual(flow.money_links[0].closure_ids,[closed.closure_id]);assert.equal(flow.money_links[0].money_covered,true);assert.equal(flow.money_links[0].amount_cents,'30000');assert.equal(flow.money_links[0].allocated_event_cents,'10000');let passed=1;console.log('PASS real unloading/shared PIX/receipt/statement/reconciliation/closure: money300 and unloading allocation100 once; other-title claim changes revision');
 await rpcArgs('reopen_finance_account_period',[{...base(),closure_id:closed.closure_id,revision:closed.revision}]);const reopened=await read();assert.notEqual(reopened.revision,flow.revision);assert.equal(reopened.receipt_totals.amount_cents,'10000');assert.equal(reopened.money_links[0].money_covered,false);passed++;console.log('PASS real reopening removes frozen coverage but preserves recorded unloading receipt');
 await assert.rejects(()=>rpcArgs('get_finance_period_unloading_flow',[i.otherTenant,scope.from,scope.to,[i.account],null,1,null]),/finance_access_denied/);await run('insert into tenant_memberships values('+q(i.tenant)+','+q(i.operator)+",'driver',true)");await assert.rejects(()=>read(),/finance_access_denied/);await run('delete from tenant_memberships where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)+" and role='driver'");const current=await read();await run('update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator));await assert.rejects(()=>rpcArgs('get_finance_period_unloading_flow',[i.tenant,scope.from,scope.to,[i.account],null,2,current.revision]),/finance_access_denied/);passed++;console.log('PASS foreign tenant, mixed driver and current revocation denied');
 return passed;
}
