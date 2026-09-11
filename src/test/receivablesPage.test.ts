// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyReceivableAssociationDatabase} from './helpers/legacyReceivableAssociationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {receivablesPageSchema} from '@/lib/financial/receivablesPageContract';
let db:PGlite;
beforeAll(async()=>{db=await createLegacyReceivableAssociationDatabase();await db.exec(readFileSync('supabase/migrations/20260910154046_finance_receivables_paged_list.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(page=1,search='',status='all',from:string|null=null,to:string|null=null,client:string|null=null){return receivablesPageSchema.parse((await operationRpc<{result:unknown}>(db,'select get_finance_receivables_page($1,$2,$3,$4,$5,$6,$7) result',[i.tenant,search,status,client,from,to,page])).rows[0].result);}
async function seed(count=1){await db.query("insert into receivables(id,tenant_id,description,amount,status,received_amount,created_at,updated_at,due_date) select gen_random_uuid(),$1,'Frete QA '||n,10,'pending',0,'2026-01-01T15:00:00Z',clock_timestamp(),'2026-01-10' from generate_series(1,$2) n",[i.tenant,count]);}
it('keeps exact totals and stable disjoint pages beyond 1000 titles',async()=>{
 await seed(1005);const first=await read(),second=await read(2),last=await read(21);
 expect(first).toMatchObject({total:1005,total_unfiltered:1005,page_size:50});expect(first.rows).toHaveLength(50);expect(second.rows).toHaveLength(50);expect(last.rows).toHaveLength(5);
 expect(new Set([...first.rows,...second.rows,...last.rows].map(row=>row.id)).size).toBe(105);
 expect((await read()).rows.map(row=>row.id)).toEqual(first.rows.map(row=>row.id));
});
it('filters literal search and due dates on the server',async()=>{
 await seed(3);expect(await read(1,'qa 2')).toMatchObject({total:1,total_unfiltered:3});expect((await read(1,'%')).total).toBe(0);
 expect((await read(1,'','all','2026-01-11')).total).toBe(0);expect((await read(1,'','all','2026-01-10','2026-01-10')).total).toBe(3);
});
it('isolates client and tenant rows and denies invalid requests',async()=>{
 await seed();const other=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Outro cliente',true)",[other,i.otherTenant]);
 await expect(read(1,'','all',null,null,other)).rejects.toThrow('finance_client_not_found');await expect(read(0)).rejects.toThrow('finance_invalid_filters');await expect(read(1,'','invalid')).rejects.toThrow('finance_invalid_filters');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
it('filters a tenant client and only active past-due titles',async()=>{
 await seed(3);const client=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Cliente específico',true)",[client,i.tenant]);
 await db.query("update receivables set client_id=$1 where description='Frete QA 1'",[client]);
 expect((await read(1,'','all',null,null,client)).rows.map(row=>row.description)).toEqual(['Frete QA 1']);
 expect((await read(1,'Cliente específico')).total).toBe(1);
 await db.query("update receivables set due_date=(now() at time zone 'America/Sao_Paulo')::date-1");
 await db.query("update receivables set due_date=(now() at time zone 'America/Sao_Paulo')::date where description='Frete QA 2'");
 await db.query("update receivables set status='cancelled' where description='Frete QA 3'");
 expect((await read(1,'','overdue')).rows.map(row=>row.description)).toEqual(['Frete QA 1']);
});
