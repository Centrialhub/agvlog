// @vitest-environment node
import {randomUUID} from 'node:crypto';import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {it,expect} from 'vitest';import {writeFileSync} from 'node:fs';import {createFinanceForwardBlockDatabase} from './helpers/financeForwardBlockDatabase';
it('installs every financial migration after152557 through170539 on the fresh integrated chain',async()=>{const {db,applied}=await createFinanceForwardBlockDatabase('20260910170540',true);try{writeFileSync('docs/qa/finance-forward-fourth-block-manifest-2026-09-11.json',JSON.stringify(applied,null,2));expect(applied.at(-1)?.file).toContain('20260910170539');
await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
const bank=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,name,account_type) values($1,$2,'Banco sem evidência','checking')",[bank,i.tenant]);
const preview=(await operationRpc<{v:{eligible:boolean;blockers:unknown[]}}>(db,'select preview_finance_account_period_close($1,$2,$3,$4) v',[i.tenant,bank,'2026-01-01','2026-01-31'])).rows[0].v;expect(preview.eligible).toBe(false);expect(preview.blockers.length).toBeGreaterThan(0);
expect((await db.query<{v:boolean}>('select finance_private.account_period_guards_ready() v')).rows[0].v).toBe(true);
const queries=[['get_finance_fiscal_dashboard_summary($1)',[i.tenant]],['get_finance_unbilled_freight_summary($1)',[i.tenant]],['get_finance_receivables_page($1)',[i.tenant]],['get_finance_legacy_cost_inventory($1)',[i.tenant]],['get_finance_stock_acquisition_inventory($1)',[i.tenant]],['get_finance_account_period_history($1,$2)',[i.tenant,bank]]] as const;
for(const [call,args] of queries)await operationRpc(db,'select '+call,[...args]);
const access=(await db.query<{v:string}>("select pg_get_functiondef('finance_private.can_access(uuid)'::regprocedure) v")).rows[0].v;
await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as 'select false'");for(const [call,args] of queries)await expect(operationRpc(db,'select '+call,[...args])).rejects.toThrow();await db.exec(access);
await db.query("insert into drivers(id,tenant_id,user_id,name,active) values($1,$2,$3,'Misto QA',true)",[randomUUID(),i.tenant,i.operator]);for(const [call,args] of queries)await expect(operationRpc(db,'select '+call,[...args])).rejects.toThrow();
expect((await db.query("select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'finance_%' and c.relkind='r' and not c.relrowsecurity")).rows).toEqual([]);
await db.exec('set constraints all immediate');await db.exec('rollback');}finally{await db.close();}},120000);
