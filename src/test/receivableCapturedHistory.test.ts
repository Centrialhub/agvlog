// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createReceivableCapturedHistoryDatabase} from './helpers/receivableCapturedHistoryDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {receivableHistorySchema} from '@/lib/financial/receivableHistoryContract';
let db:PGlite;
beforeAll(async()=>{db=await createReceivableCapturedHistoryDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(id:string|null=null,page=1,revision:string|null=null,tenant=i.tenant){return receivableHistorySchema.parse((await operationRpc<{result:unknown}>(db,'select get_finance_receivable_history($1,$2,$3,$4) result',[tenant,id,page,revision])).rows[0].result);}
async function title(){const id=randomUUID();await db.query("insert into receivables(id,tenant_id,amount,received_amount,status,due_date,description) values($1,$2,12.34,0,'pending','2026-01-31','Origem inicial')",[id,i.tenant]);return id;}
it('paginates the entire captured journal beyond 1000 without losing IDs',async()=>{
 await db.query("insert into receivables(id,tenant_id,amount,received_amount,status) select gen_random_uuid(),$1,1,0,'pending' from generate_series(1,1005)",[i.tenant]);
 const first=await read();expect(first.total).toBe(1005);expect(first.rows).toHaveLength(50);
 const ids=first.rows.map(r=>r.event_order);for(let page=2;page<=21;page++)ids.push(...(await read(null,page,first.revision)).rows.map(r=>r.event_order));
 expect(ids).toHaveLength(1005);expect(new Set(ids).size).toBe(1005);
 expect(ids.every((id,index)=>index===0||BigInt(ids[index-1])>BigInt(id))).toBe(true);
});
it('shows changed public fields and deleted title snapshots without querying current titles',async()=>{
 const id=await title();await db.query("update receivables set amount=25,due_date='2026-02-28' where id=$1",[id]);await db.query('delete from receivables where id=$1',[id]);
 const result=await read(id);expect(result.total).toBe(3);expect(result.rows.map(r=>r.operation)).toEqual(['DELETE','UPDATE','INSERT']);
 expect(result.rows[1].changed_fields).toEqual(['amount_cents','due_date']);expect(result.rows[1]).toMatchObject({before:{amount_cents:'1234'},after:{amount_cents:'2500'}});
 expect(result.rows[0].after).toBeNull();expect(result.rows[0].before?.amount_cents).toBe('2500');
 expect((await read(randomUUID())).total).toBe(0);
});
it('keeps revision stable on repeated reads and detects changes anywhere in the chosen set',async()=>{
 const id=await title(),first=await read(id);expect((await read(id)).revision).toBe(first.revision);
 await title();expect((await read(id,1,first.revision)).revision).toBe(first.revision);
 await db.query("update receivables set notes='internal field still belongs to fingerprint' where id=$1",[id]);
 await expect(read(id,1,first.revision)).rejects.toThrow('finance_history_changed');
 await expect(read(null,2)).rejects.toThrow('finance_history_revision_required');await expect(read(null,0)).rejects.toThrow('finance_invalid_history_page');
});
it('returns exact cents or diagnostic null, never rounds or assumes null receipts equal zero',async()=>{
 const id=randomUUID();await db.query("insert into receivables(id,tenant_id,amount,received_amount,status,due_date) values($1,$2,12.345,null,'pending','infinity')",[id,i.tenant]);
 const result=await read(id);expect(result.rows[0].after).toMatchObject({amount_cents:null,received_cents:null,due_date:null,issues:['amount_invalid','due_date_invalid','received_amount_unknown']});
});
it('preserves exact historical cents above modern writer limits',async()=>{
 const id=randomUUID();await db.query("insert into receivables(id,tenant_id,amount,received_amount,status) values($1,$2,1000000000000.01,0,'pending')",[id,i.tenant]);
 expect((await read(id)).rows[0].after).toMatchObject({amount_cents:'100000000000001',received_cents:'0',issues:[]});
});
it('preserves actor and payer captured labels when current names change',async()=>{
 const payer=randomUUID();await db.query("insert into clients(id,tenant_id,company_name) values($1,$2,'Nome capturado')",[payer,i.tenant]);
 const id=await title();await db.query('update receivables set client_id=$1 where id=$2',[payer,id]);
 const first=await read(id);await db.query("update clients set company_name='Nome atual' where id=$1",[payer]);await db.query("update auth.users set email='new@example.test',raw_user_meta_data='{}' where id=$1",[i.operator]);
 const next=await read(id);expect(next.revision).toBe(first.revision);expect(next.rows[0]).toMatchObject({actor_name:'Financeiro QA',after:{payer:{id:payer,tenant_id:i.tenant,company_name:'Nome capturado'}}});
});
it('isolates journal access without granting tables and rejects mixed drivers',async()=>{
 await title();await expect(read(null,1,null,i.otherTenant)).rejects.toThrow('finance_access_denied');
 await db.exec('savepoint acl;set role authenticated');await expect(db.exec('select * from finance_private.receivable_temporal_versions')).rejects.toThrow('permission denied');await db.exec('rollback to savepoint acl;release savepoint acl');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
