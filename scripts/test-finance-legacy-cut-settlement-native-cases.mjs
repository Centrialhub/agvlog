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

export async function runLegacyCutSettlementNative({query,contested,literal:q,createRoles=false}){
 const database='finance_legacy_cut_settlement_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 // Full command/trigger bodies; tables were installed from their real definitions.
 const links=readFileSync('supabase/migrations/20260910130540_finance_settlement_movement_links.sql','utf8');await run(links.slice(links.indexOf('create or replace function finance_private.movement_used_cents')));
 for(const file of ['20260910130921_finance_settlement_movement_options.sql','20260910131149_finance_settlement_link_audit.sql'])await run(readFileSync('supabase/migrations/'+file,'utf8'));
 const reversal=readFileSync('supabase/migrations/20260910132411_finance_settlement_link_reversals.sql','utf8');await run(reversal.replace(/create table public\.finance_settlement_link_reversals\([\s\S]*?\n\);/,''));
 for(const file of ['20260910163116_finance_legacy_cut_reviews.sql','20260910170213_finance_legacy_cut_settlement_mapping.sql','20260910130540_finance_settlement_movement_links.sql','20260910132411_finance_settlement_link_reversals.sql'])console.log(file+' SHA256 '+createHash('sha256').update(readFileSync('supabase/migrations/'+file)).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência do vínculo e corte do motorista'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 const read=async()=>legacyCutReviewSchema.parse(JSON.parse(await run(`${auth}select get_finance_legacy_cut_review(${q(i.tenant)},${q(i.account)},'2026-01-01','2026-01-31')`)));
 const reviewPayload=async()=>({...base(),account_id:i.account,from:'2026-01-01',to:'2026-01-31',revision:(await read()).revision,sources_reviewed:true});
 async function seed(existing=null){const settlement=randomUUID(),payment=randomUUID();await run(`${identity}insert into driver_settlements(id,tenant_id,driver_id,status,driver_payable_amount) values(${q(settlement)},${q(i.tenant)},${q(i.driver)},'approved',5);insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values(${q(payment)},${q(i.tenant)},${q(settlement)},5,'2026-01-11T01:00:00Z')`);const movement=existing??(await rpc('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'driver_advance',driver_id:i.driver,amount_cents:500,occurred_on:'2026-01-10',description:'Saída registrada ao motorista',beneficiary_name:'Motorista QA'})).movement_id;return{settlement,payment,movement};}
 const link=f=>({...base(),payment_id:f.payment,movement_id:f.movement}),money=()=>run("select jsonb_build_object('movements',(select jsonb_agg(to_jsonb(x) order by id) from finance_movements x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlement_payments x))");let first,firstLink;
 const tests=[
 ['real link command and replay yield a positive cut with unchanged money',async()=>{first=await seed();const p=link(first),before=await money();await race(call('link_finance_settlement_payment',p),call('link_finance_settlement_payment',p),{waiterSucceeds:true});firstLink=await rpc('link_finance_settlement_payment',p);assert.deepEqual((await read()).blockers,[]);await rpc('review_finance_legacy_cut',await reviewPayload());assert.equal((await read()).approved,true);assert.equal(await money(),before);}],
 ['reversal versus stale cut review invalidates it atomically then relink resolves',async()=>{const p=await reviewPayload(),before=await money();const r=await race(call('reverse_finance_settlement_link',{...base(),link_id:firstLink.link_id}),call('review_finance_legacy_cut',p),{waiterSucceeds:false});assert.match(r.error,/legacy_cut_changed/);assert.equal((await read()).approved,false);assert.equal((await read()).blockers.length,1);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(p.request_id)}`),'0');firstLink=await rpc('link_finance_settlement_payment',link(first));await rpc('review_finance_legacy_cut',await reviewPayload());assert.equal((await read()).approved,true);assert.equal(await money(),before);}],
 ['two historical payments dispute one outgoing capacity and preserve exactly one active owner',async()=>{const a=await seed(),b=await seed(a.movement),before=await money();const r=await race(call('link_finance_settlement_payment',link(a)),call('link_finance_settlement_payment',link(b)),{waiterSucceeds:false});assert.match(r.error,/movement_overallocated/);const p=await read();assert.equal(p.manifest.sources.find(x=>x.source_id===a.payment).classification,'exact_canonical_mapping');assert.notEqual(p.manifest.sources.find(x=>x.source_id===b.payment).classification,'exact_canonical_mapping');assert.equal(await money(),before);}],
 ['reversal competing with another payment relink releases capacity without new cash',async()=>{const other=await seed(first.movement),before=await money();await race(call('reverse_finance_settlement_link',{...base(),link_id:firstLink.link_id}),call('link_finance_settlement_payment',link(other)),{waiterSucceeds:true});const p=await read();assert.equal(p.manifest.sources.find(x=>x.source_id===other.payment).classification,'exact_canonical_mapping');assert.notEqual(p.manifest.sources.find(x=>x.source_id===first.payment).classification,'exact_canonical_mapping');assert.equal(await money(),before);assert.equal(await run(`select count(*) from finance_settlement_movement_links l where movement_id=${q(first.movement)} and not exists(select 1 from finance_settlement_link_reversals r where r.link_id=l.id)`),'1');}],
 ['revoked administrator after lock wait cannot associate and leaves no command residue',async()=>{const f=await seed(),p=link(f);const r=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,call('link_finance_settlement_payment',p),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/access_denied/);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(p.request_id)}`),'0');await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);}]
 ];for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
