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

export async function runPaidRealCloseNative({query,contested,literal:q,createRoles=false}){
const database='finance_paid_real_close_qa';await query('create database '+database);const run=sql=>query(sql,database),param=v=>v==null?'null':q(Array.isArray(v)?'{'+v.join(',')+'}':typeof v==='object'?JSON.stringify(v):String(v));const db={exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1])))};await prepareFinanceLedgerDatabase(db,createRoles);await prepareDatabase(db,true);await prepareLateComposition(db);
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');await run(baseline.match(/CREATE TABLE public\.financial_obligations \([\s\S]*?\n\);/)[0]);await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8').match(/create or replace view finance_private\.active_payable_payments[\s\S]*?;/)[0]);for(const file of ['20260910170213_finance_legacy_cut_settlement_mapping.sql','20260910172624_finance_paid_projection_chains.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');if(file.includes('170213')){if(await run("select to_regprocedure('finance_private.legacy_cut_settlement_evidence(uuid,uuid)') is null")==='t')await run(sql);}else await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
const rev=readFileSync('supabase/migrations/20260910003529_finance_payable_link_reversal.sql','utf8');await run(rev.slice(rev.indexOf('create function finance_private.reverse_payable_link'),rev.indexOf('create function finance_private.payable_payment_history')));
const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';await run(`update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência completa com projeções de folha'}),call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`,rpc=async(name,p)=>JSON.parse(await run(call(name,p)));
const financeAs=async(_db,actor,sql,params)=>({rows:[{v:JSON.parse(await run(`set request.jwt.claim.sub=${q(actor)};set role authenticated;`+sql.replace(/\$(\d+)/g,(_,n)=>param(params[Number(n)-1]))))}]});const preview=async()=>accountPeriodClosePreviewSchema.parse((await financeAs(db,i.operator,'select preview_finance_account_period_close($1,$2,$3,$4) v',[i.tenant,i.account,'2026-08-01','2026-08-31'])).rows[0].v);const expect=value=>({toEqual:other=>assert.deepEqual(value,other),toBe:other=>assert.equal(value,other),toContain:other=>assert.ok(value.includes(other))});
const advance = randomUUID(), employee = randomUUID(), payable = randomUUID(), period = randomUUID(), entry = randomUUID(), item = randomUUID(); await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Funcionário')", [employee, i.tenant]); await db.query("insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,payable_id) values($1,$2,$3,50,'2026-08-01','paid',$4)", [advance, i.tenant, employee, payable]); await db.query("insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values($1,$2,'Funcionário','payroll',50,'approved','employee_advances',$3)", [payable, i.tenant, advance]); const money = await rpc('record_finance_movement', { ...base(), bank_account_id: i.account, direction: 'out', nature: 'payment', amount_cents: 5000, occurred_on: '2026-08-15', description: 'Adiantamento pago', beneficiary_name: 'Funcionário' }); await rpc('apply_finance_payable_movement', { ...base(), movement_id: money.movement_id, payable_id: payable, amount_cents: 5000, method: 'pix' }); await db.query("insert into payroll_periods(id,tenant_id,period_name,period_start,period_end,status) values($1,$2,'Agosto','2026-08-01','2026-08-31','draft')", [period, i.tenant]); await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,entry_type,status) values($1,$2,$3,$4,'employee','draft')", [entry, i.tenant, period, employee]); await db.query("insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount,source_table,source_id) values($1,$2,$3,$4,$5,'advance','already_paid','Adiantamento',50,'employee_advances',$6)", [item, i.tenant, period, entry, employee, advance]);  await seedAccountCloseStatement(db, '2026-07-31', 10000); const statement = await seedAccountCloseStatement(db, '2026-08-31', 5000, '2026-08-01', '2026-08-31', [{ day: '2026-08-15', cents: -5000 }]); await db.exec('select finance_private.run_automatic_reconciliation_queue()'); const context = (await financeAs(db, i.operator, 'select get_finance_reconciliation_context($1,$2,$3) v', [i.tenant, [money.movement_id], statement.entryIds])).rows[0].v; await rpc('reconcile_finance_bank_group', { ...base(), movement_ids: [money.movement_id], bank_entry_ids: statement.entryIds, expected_revision: context.revision, account_evidence: 'Conta e titular conferidos no documento bancário' }); const scope = { account_id: i.account, from: '2026-08-01', to: '2026-08-31' }; for (const [read, write, extra] of [['get_finance_statement_period_evidence', 'record_finance_account_opening', {}], ['get_finance_statement_coverage_review', 'record_finance_statement_coverage_approval', { originals_obtained_from_bank: true, complete_period_confirmed: true }], ['get_finance_legacy_cut_review', 'review_finance_legacy_cut', { sources_reviewed: true }]]) {
    const evidence = (await financeAs(db, i.operator, `select ${read}($1,$2,$3,$4) v`, [i.tenant, i.account, scope.from, scope.to])).rows[0].v;
    await rpc(write, { ...base(), ...scope, revision: evidence.revision, ...extra });
} const p = await preview(); expect(p.blockers).toEqual([]); expect(p.eligible).toBe(true); const closed = accountPeriodCloseResultSchema.parse(await rpc('close_finance_account_period', { ...base(), ...scope, revision: p.revision })); const e = accountPeriodEvidenceSchema.parse((await financeAs(db, i.operator, 'select get_finance_account_period_evidence($1,$2,$3) v', [i.tenant, i.account, closed.closure_id])).rows[0].v); expect(e.integrity).toEqual({ snapshot_matches_revision: true, dependencies_match: true }); expect(JSON.stringify(e.snapshot)).toContain(advance); expect(JSON.stringify(e.snapshot)).toContain(item);
console.log('PASS real close with counted aliases and complete evidence export');await rpc('reopen_finance_account_period',{...base(),closure_id:closed.closure_id,revision:closed.revision});const current=await preview();assert.equal(current.eligible,true);const link=await run(`select id from finance_payable_movement_links where payable_id=${q(payable)}`);const reverse={...base(),link_id:link};const result=await contested(call('reverse_finance_payable_link',reverse),call('close_finance_account_period',{...base(),...scope,revision:current.revision}),{database,driver:false,waiterSucceeds:false});assert.match(result.error,/finance_period_close_changed|not_eligible/);assert.equal(await run(`select count(*) from finance_account_period_closures c where not exists(select 1 from finance_account_period_reopenings r where r.closure_id=c.id)`),'0');console.log('PASS real reversal versus real close rejects stale revision without active closure');return 2;}
