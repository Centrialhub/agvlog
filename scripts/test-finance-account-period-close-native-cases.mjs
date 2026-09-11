import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
import {accountPeriodClosePreviewSchema,accountPeriodCloseResultSchema} from '../src/lib/financial/accountPeriodCloseContract.ts';
import {accountPeriodEvidenceSchema} from '../src/lib/financial/accountPeriodEvidenceContract.ts';
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
            ['20260910025658_finance_receipt_allocation_corrections', 'finance_receipt_allocation_corrections'], ['20260910024438_finance_receivable_movement_projection', 'finance_receivable_movement_links'], ['20260910002244_finance_payable_movement_links', 'finance_payable_movement_links'], ['20260910003529_finance_payable_link_reversal', 'finance_payable_link_reversals'], ['20260910130540_finance_settlement_movement_links', 'finance_settlement_movement_links'], ['20260910132411_finance_settlement_link_reversals', 'finance_settlement_link_reversals'], ['20260910145616_finance_legacy_receipt_associations', 'finance_legacy_receipt_movement_links'], ['20260910145616_finance_legacy_receipt_associations', 'finance_legacy_receipt_link_reversals'], ['20260909212514_finance_delivery_unloading', 'finance_unloading_charges'], ['20260909213959_finance_expense_batches', 'finance_expense_batches'], ['20260909213959_finance_expense_batches', 'finance_expense_items']
        ]) {
            const sql = readFileSync(`supabase/migrations/${file}.sql`, 'utf8');
            let ddl = sql.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`, 'i'))?.[0];
            if (!ddl)
                throw new Error(table);
            ddl = ddl.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi, '').replace(/ references public\.\w+\([^)]*\)/g, '');
            await db.exec(ddl);
        }
        await db.exec(readFileSync('supabase/migrations/20260909220941_finance_receipt_evidence.sql', 'utf8').replace('create function finance_private.can_read_receipt', 'create or replace function finance_private.can_read_receipt'));
        for (const name of ['20260910151011_finance_legacy_integrity_inventory', '20260910163109_finance_account_period_closed_source_guards', '20260910163116_finance_legacy_cut_reviews', '20260910164923_finance_account_period_closure_evidence'])
            await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
    }
    return db;
}

async function seedAccountCloseStatement(db, day, cents, from = '2026-08-01', to = '2026-08-31', entries = []) {
    const id = randomUUID(), verification = randomUUID(), hash = id.replace(/-/g, '').repeat(2);
    const date = (value, time) => ({ date: value, raw: value.replace(/-/g, '') + time + '[-3:BRT]', offset_minutes: -180 });
    await db.query("insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by) values($1,$2,$3,$4,$5,'extrato.ofx','{}','native-ofx-v1','{}',$6,$7,'BRL',$9,$8)", [id, i.tenant, i.account, hash, 'qa/' + id, from, to, i.operator, entries.length]);
    const entryIds = [];
    for (const [index, entry] of entries.entries()) {
        const entryId = randomUUID();
        entryIds.push(entryId);
        await db.query("insert into finance_bank_entries(id,tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,bank_id,description,raw) values($1,$2,$3,$4,$5,$6,$7,'BRL',$8,'Entrada bancária real','{}')", [entryId, i.tenant, i.account, id, index + 1, entry.day, entry.cents, entryId]);
        await db.query("insert into finance_statement_rows(tenant_id,import_id,source_row,raw,classification,bank_entry_id) values($1,$2,$3,'{}','new',$4)", [i.tenant, id, index + 1, entryId]);
    }
    const report = { hash_verified: true, actual_hash: hash, identity_trust: 'native_file_identifier', native_evidence: { parser_version: 'native-ofx-v1', currency: 'BRL', account: { bank_id: '001', branch_id: '1234', account_id: '123-4', account_type: 'CHECKING' }, outside_declared_period: false, repeated_bank_ids: [], period: { start: date(from, '000000'), end: date(to, '235959') }, ledger_balance: { amount_cents: cents, as_of: date(day, '235959') } } };
    await db.query("insert into finance_statement_verifications(id,tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values($1,$2,$3,$4,'statement-source-v1','revision','rows_match',$5)", [verification, i.tenant, id, i.operator, report]);
    return { id, verification, entryIds };
}

async function prepareLateComposition(db) {

    const read = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
    const expense = read('20260909213959_finance_expense_batches').match(/create table public\.finance_expense_allocations\s*\([\s\S]*?\n\);/)?.[0];
    if (!expense)
        throw new Error('allocations');
    await db.exec(expense);
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

export async function runAccountPeriodCloseNative({query,contested,literal:q,createRoles=false}){
 const database='finance_account_period_close_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};
 await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
 for(const file of ['20260910162807_finance_account_period_closure_foundation.sql','20260910162958_finance_account_period_close_snapshot.sql','20260910163109_finance_account_period_closed_source_guards.sql','20260910163116_finance_legacy_cut_reviews.sql','20260910164923_finance_account_period_closure_evidence.sql','20260910164942_finance_closed_period_late_payment_composition.sql'])console.log(file+' SHA256 '+createHash('sha256').update(readFileSync('supabase/migrations/'+file)).digest('hex'));
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(identity+`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência integral do período bancário'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p))),scope=(from,to)=>({account_id:i.account,from,to});
 const preview=async(from='2026-07-01',to='2026-07-31')=>accountPeriodClosePreviewSchema.parse(JSON.parse(await run(`${auth}select preview_finance_account_period_close(${q(i.tenant)},${q(i.account)},${q(from)},${q(to)})`)));
 async function approve(from,to,opening=false){const s=scope(from,to);for(const [read,write,extra] of [...(opening?[['get_finance_statement_period_evidence','record_finance_account_opening',{}]]:[]),['get_finance_statement_coverage_review','record_finance_statement_coverage_approval',{originals_obtained_from_bank:true,complete_period_confirmed:true}],['get_finance_legacy_cut_review','review_finance_legacy_cut',{sources_reviewed:true}]]){const p=JSON.parse(await run(`${auth}select ${read}(${q(i.tenant)},${q(i.account)},${q(from)},${q(to)})`));await rpc(write,{...base(),...s,revision:p.revision,...extra});}}
 const closePayload=async()=>({...base(),...scope('2026-07-01','2026-07-31'),revision:(await preview()).revision});const money=()=>run('select coalesce(jsonb_agg(to_jsonb(m) order by id),\'[]\') from finance_movements m');const race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 await seedAccountCloseStatement(db,'2026-06-30',10000,'2026-07-01','2026-07-31');const statement=await seedAccountCloseStatement(db,'2026-07-31',10500,'2026-07-01','2026-07-31',[{day:'2026-07-10',cents:1000},{day:'2026-07-11',cents:-500}]);await seedAccountCloseStatement(db,'2026-08-31',10500,'2026-08-01','2026-08-31');
 const movement=await rpc('record_finance_movement',{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:1000,occurred_on:'2026-07-10',description:'Entrada bancária registrada',beneficiary_name:'Cliente QA'});await run(identity+'select finance_private.run_automatic_reconciliation_queue()');const context=JSON.parse(await run(`${auth}select get_finance_reconciliation_context(${q(i.tenant)},array[${q(movement.movement_id)}]::uuid[],array[${q(statement.entryIds[0])}]::uuid[])`));await rpc('reconcile_finance_bank_group',{...base(),movement_ids:[movement.movement_id],bank_entry_ids:[statement.entryIds[0]],expected_revision:context.revision,account_evidence:'Conta e identidade conferidas no extrato'});const outgoing=await rpc('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:500,occurred_on:'2026-07-11',description:'Saída registrada antes do fechamento',beneficiary_name:'Fornecedor QA'});const outContext=JSON.parse(await run(`${auth}select get_finance_reconciliation_context(${q(i.tenant)},array[${q(outgoing.movement_id)}]::uuid[],array[${q(statement.entryIds[1])}]::uuid[])`));await rpc('reconcile_finance_bank_group',{...base(),movement_ids:[outgoing.movement_id],bank_entry_ids:[statement.entryIds[1]],expected_revision:outContext.revision,account_evidence:'Saída conferida na conta bancária'});await approve('2026-07-01','2026-07-31',true);
 let closed;const tests=[
 ['real reconciled money closes against retroactive movement without mutation',async()=>{assert.deepEqual((await preview()).blockers,[]);const p=await closePayload(),before=await money();const r=await race(call('close_finance_account_period',p),call('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:100,occurred_on:'2026-07-20',description:'Saída concorrente',beneficiary_name:'Fornecedor QA'}),{waiterSucceeds:false});assert.match(r.error,/closed/);closed=accountPeriodCloseResultSchema.parse(await rpc('close_finance_account_period',p));assert.equal(await money(),before);}],
 ['snapshot and every dependency remain exact across reopening and replay',async()=>{const read=async()=>accountPeriodEvidenceSchema.parse(JSON.parse(await run(`${auth}select get_finance_account_period_evidence(${q(i.tenant)},${q(i.account)},${q(closed.closure_id)})`)));const before=await read();assert.deepEqual(before.integrity,{snapshot_matches_revision:true,dependencies_match:true});const p={...base(),closure_id:closed.closure_id,revision:closed.revision};await race(call('reopen_finance_account_period',p),call('reopen_finance_account_period',p),{waiterSucceeds:true});assert.deepEqual((await read()).snapshot,before.snapshot);assert.deepEqual((await read()).integrity,before.integrity);}],
 ['close serializes against another source review and retains the approved source',async()=>{const p=await closePayload();const cut=JSON.parse(await run(`${auth}select get_finance_legacy_cut_review(${q(i.tenant)},${q(i.account)},'2026-07-01','2026-07-31')`));const r=await race(call('close_finance_account_period',p),call('review_finance_legacy_cut',{...base(),...scope('2026-07-01','2026-07-31'),revision:cut.revision,sources_reviewed:true}),{waiterSucceeds:false});assert.match(r.error,/closed/);closed=await rpc('close_finance_account_period',p);await rpc('reopen_finance_account_period',{...base(),closure_id:closed.closure_id,revision:closed.revision});}],
 ['revoked administrator cannot close after waiting on tenant lock',async()=>{const p=await closePayload();const r=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,call('close_finance_account_period',p),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/access_denied/);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(p.request_id)}`),'0');await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);}],
 ['same close request racing replays one immutable closure',async()=>{const p=await closePayload();await race(call('close_finance_account_period',p),call('close_finance_account_period',p),{waiterSucceeds:true});closed=await rpc('close_finance_account_period',p);assert.equal(await run(`select count(*) from finance_account_period_closures where request_id=${q(p.request_id)}`),'1');}],
 ['next month closes contiguously with equal anchor and predecessor cannot reopen',async()=>{await approve('2026-08-01','2026-08-31');const p=await preview('2026-08-01','2026-08-31');assert.deepEqual(p.blockers,[]);assert.equal(p.predecessor_id,closed.closure_id);assert.equal(p.balances.opening_cents,'10500');await rpc('close_finance_account_period',{...base(),...scope('2026-08-01','2026-08-31'),revision:p.revision});await assert.rejects(()=>rpc('reopen_finance_account_period',{...base(),closure_id:closed.closure_id,revision:closed.revision}),/descendants/);assert.equal(await run('select count(*) from finance_movements'),'2');}]
 ];tests.splice(5,0,
 ['late real payable commands compete only for frozen capacity and preserve money',async()=>{const a=randomUUID(),b=randomUUID();await run(`insert into payables(id,tenant_id,supplier_name,category,amount,status) values(${q(a)},${q(i.tenant)},'Fornecedor','other',5,'approved'),(${q(b)},${q(i.tenant)},'Fornecedor','other',5,'approved')`);const first={...base(),payable_id:a,movement_id:outgoing.movement_id,amount_cents:500,method:'pix'},second={...first,payable_id:b,request_id:randomUUID()},before=await money();const r=await race(call('apply_finance_payable_movement',first),call('apply_finance_payable_movement',second),{waiterSucceeds:false});assert.match(r.error,/finance_movement_overallocated/);const payment=await rpc('apply_finance_payable_movement',first);assert.ok(payment.payment_id);assert.equal(await run(`select count(*) from payables_payments where payable_id in(${q(a)},${q(b)})`),'1');assert.equal(await money(),before);}],
 ['late exact incoming projection commits only with complete receipt bank movement chain',async()=>{const title=randomUUID(),payment=randomUUID(),bank=randomUUID(),command=randomUUID(),before=await money();await run(`${identity}begin;insert into receivables(id,tenant_id,amount,status,description) values(${q(title)},${q(i.tenant)},10,'pending','Título conferido');insert into receivable_financial_commands(id,tenant_id,actor_id,request_id,receivable_id,action,reason,payload_hash,before_snapshot,after_snapshot,response) values(${q(command)},${q(i.tenant)},${q(i.operator)},gen_random_uuid(),${q(title)},'receive','Recebimento conferido','hash','{}','{}','{}');insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type) values(${q(bank)},${q(i.tenant)},${q(i.account)},'2026-07-10T12:00:00Z',10,'credit');insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,bank_transaction_id,financial_command_id) values(${q(payment)},${q(i.tenant)},${q(title)},10,'2026-07-10T12:00:00Z',${q(i.account)},'pix',${q(bank)},${q(command)});insert into finance_receivable_movement_links(tenant_id,command_id,payment_id,bank_transaction_id,movement_id,action) values(${q(i.tenant)},${q(command)},${q(payment)},${q(bank)},${q(movement.movement_id)},'receive');set constraints all immediate;commit;`);assert.equal(await money(),before);const proof=accountPeriodEvidenceSchema.parse(JSON.parse(await run(`${auth}select get_finance_account_period_evidence(${q(i.tenant)},${q(i.account)},${q(closed.closure_id)})`)));assert.deepEqual(proof.integrity,{snapshot_matches_revision:true,dependencies_match:true});}],
 ['unlinked and foreign-account late payments roll back at deferred boundary',async()=>{for(const account of [i.account,i.otherAccount]){const title=randomUUID(),payment=randomUUID();await run(`insert into payables(id,tenant_id,supplier_name,category,amount,status) values(${q(title)},${q(i.tenant)},'Fornecedor','other',5,'approved')`);await assert.rejects(()=>run(`${identity}begin;insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method) values(${q(payment)},${q(i.tenant)},${q(title)},5,'2026-07-11T12:00:00Z',${q(account)},'pix');set constraints all immediate;commit;`),/finance_account_period_closed/);assert.equal(await run(`select count(*) from payables_payments where id=${q(payment)}`),'0');}}]
 );for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
