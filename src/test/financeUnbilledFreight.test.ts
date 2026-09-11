// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {unbilledFreightSummarySchema,unbilledFreightOriginsSchema} from '@/lib/financial/unbilledFreightContract';
import {seedUndelivered} from './helpers/deliveryAttemptDatabase';
import {redeliveryPayload,requestRedelivery} from './helpers/redeliveryDatabase';
import {createClosingWithClient,closingAction,closingActionPayload} from './helpers/closingLifecycleDatabase';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createUnbilledFreightDatabase} from './helpers/unbilledFreightDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let testClient:string;
let db:Awaited<ReturnType<typeof createUnbilledFreightDatabase>>;
beforeAll(async()=>{db=await createUnbilledFreightDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');testClient=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Cliente teste',true)",[testClient,i.tenant]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(from:string|null=null,to:string|null=null){return unbilledFreightSummarySchema.parse((await operationRpc<{result:Record<string,unknown>}>(db,'select get_finance_unbilled_freight_summary($1,$2,$3,$4) result',[i.tenant,from,to,testClient])).rows[0].result);}
async function rows(page=1,state:string|null=null,client:string|null=testClient){return unbilledFreightOriginsSchema.parse((await operationRpc<{result:unknown}>(db,'select list_finance_unbilled_freight_origins($1,null,null,$2,$3,$4) result',[i.tenant,client,state,page])).rows[0].result);}
async function document(freight:number|null=100){const id=randomUUID(),client=testClient;await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,client_id,issue_date,freight_value,value,is_duplicate,deleted_at) values($1,$2,'inbound','pending',$3,'2026-01-01',$4,999999,false,null)",[id,i.tenant,client,freight]);return id;}
async function emission(doc:string,status='authorized',dispatch='recorded'){
 const source=randomUUID(),id=randomUUID();await db.query('insert into cte_documents(id,tenant_id,fiscal_document_ids,freight_value,status) values($1,$2,$3,100,$4)',[source,i.tenant,[doc],status]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production',$3,$4,$5,$6,$7,'123')",[id,i.tenant,status,dispatch,source,'1'.repeat(44),status==='rejected'?null:'2'.repeat(15)]);return{id,source};
}
it('counts more than1000 exact NF origins using freight not merchandise',async()=>{
 const client=testClient;
 await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,client_id,issue_date,freight_value,value,is_duplicate) select gen_random_uuid(),$1,'inbound','pending',$2,'2026-01-01',1.01,999999,false from generate_series(1,1005)",[i.tenant,client]);
 expect(await read()).toMatchObject({total_origins:1005,available_count:1005,forecast_cents:'101505',totals_valid:true,expected_receipt_date:null,coverage_complete:false});
});
it('separates authorized, pending and uncertain fiscal coverage',async()=>{
 const a=await document(),b=await document(),c=await document();await emission(a);await emission(b,'processing');await emission(c,'processing','uncertain');
 expect(await read()).toMatchObject({total_origins:3,authorized_count:1,reserved_count:1,uncertain_count:1,available_count:0,forecast_cents:'0'});
});
it('releases never-authorized rejection but keeps cancellation as commercial review',async()=>{
 const a=await document(),b=await document();await emission(a,'rejected');const e=await emission(b);await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[e.id]);
 expect(await read()).toMatchObject({available_count:1,review_count:1,forecast_cents:null});
});
it('does not hide unknown freight/date or double invoice identities',async()=>{
 const a=await document(null),b=await document();await db.query("update fiscal_documents set issue_date='infinity' where id=$1",[b]);
 expect(await read('2026-01-01','2026-01-01')).toMatchObject({review_count:2,undated_count:1,forecast_cents:null});
 await db.query("update fiscal_documents set freight_value=100,issue_date='2026-01-01',access_key=$1 where id=any($2)",['9'.repeat(44),[a,b]]);
 expect(await read()).toMatchObject({review_count:2,forecast_cents:null});
});
it('excludes cancelled service and rejects drivers and foreign client filters',async()=>{
 const a=await document();await db.query("update fiscal_documents set status='cancelled' where id=$1",[a]);expect(await read()).toMatchObject({cancelled_count:1,forecast_cents:'0'});
 await expect(operationRpc(db,'select get_finance_unbilled_freight_summary($1,null,null,$2)',[i.tenant,randomUUID()])).rejects.toThrow('finance_client_not_found');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
it('preserves immutable fiscal observation links after current catalog associations disappear',async()=>{
 const doc=await document();const e=await emission(doc);await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[e.id]);
 await db.query('update cte_documents set fiscal_document_ids=null where id=$1',[e.source]);
 expect(await read()).toMatchObject({review_count:1,available_count:0,forecast_cents:null});
 expect((await rows()).rows[0].issues).toContain('cancelled_service_requires_review');
});
it('pages diagnostics without losing IDs and invalidates ambiguous authorizations',async()=>{
 for(let n=0;n<31;n++)await document(null);
 const first=await rows(1,'review'),second=await rows(2,'review');expect(first.total).toBe(31);expect(first.rows).toHaveLength(30);expect(second.rows).toHaveLength(1);expect(new Set([...first.rows,...second.rows].map(r=>r.document_id)).size).toBe(31);
 const doc=await document();await emission(doc);await emission(doc);
 expect((await rows(2,'review')).total).toBe(32);expect((await read()).diagnostics.multiple_authorizations).toBe(1);
});
it('does not inherit original freight into a real audited redelivery attempt',async()=>{
 const stop=(await db.query<{dispatch_stop_id:string}>('select dispatch_stop_id from dispatch_stop_documents where fiscal_document_id=$1 order by id limit 1',[i.doc])).rows[0].dispatch_stop_id;
 await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
 const result=await rows(1,null,null);const own=result.rows.filter(r=>r.document_id===i.doc);
 expect(own).toHaveLength(2);const attempt=own.find(r=>r.attempt_id!==null)!;
 expect(attempt).toMatchObject({state:'review',freight_cents:null,date_basis:'attempt_recorded_date',issues:['unpriced_redelivery']});
});
it('does not forecast the whole NF again when a real commercial closing claims its charge',async()=>{
 const result=await createClosingWithClient(db);await closingAction(db,await closingActionPayload(db,result.report.id));
 const claims=(await db.query<{fiscal_document_id:string}>('select fiscal_document_id from closing_report_charge_claims where tenant_id=$1 and released_at is null',[i.tenant])).rows;
 expect(claims.length).toBeGreaterThan(0);
 const all=await rows(1,null,null);for(const claim of claims){const row=all.rows.find(r=>r.document_id===claim.fiscal_document_id&&r.attempt_id===null)!;expect(row.state).toBe('review');expect(row.issues).toContain('commercial_claim_requires_allocation_review');}
});
it('uses exact reservation IDs and releases a never-authorized rejection without inventing money',async()=>{
 const doc=await document(),outbound=randomUUID(),id=randomUUID();
 await db.query("insert into fiscal_documents(id,tenant_id,document_type,status) values($1,$2,'outbound','draft')",[outbound,i.tenant]);
 await db.query("insert into fiscal_source_reservations values($1,'production',$2,$3,null)",[i.tenant,doc,outbound]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,fiscal_document_id) values($1,$2,'cte','production','processing','in_flight',$3)",[id,i.tenant,outbound]);
 expect(await read()).toMatchObject({uncertain_count:1,forecast_cents:'0'});
 await db.query("update hub_fiscal_emissions set status='rejected',dispatch_state='recorded' where id=$1",[id]);
 expect(await read()).toMatchObject({available_count:1,forecast_cents:'10000'});
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
});
