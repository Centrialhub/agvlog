// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {createInvoiceLifecycleDatabase,createInvoiceScenario,invoiceCommand,invoiceActionPayload,manualInvoiceDraft} from './helpers/clientInvoiceLifecycleDatabase';
import {createClosingWithClient,closingActionPayload,closingAction} from './helpers/closingLifecycleDatabase';
import {closingDraftPayload,createClosingDraft} from './helpers/closingDraftDatabase';
import {closingSourceFilters} from './helpers/closingSourcesDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
const readers=read('20260911025149_finance_receivable_invoice_active_read_boundary');
const writer=read('20260911025214_finance_client_invoice_active_command_boundary');
const opened:Array<Awaited<ReturnType<typeof createInvoiceLifecycleDatabase>>['db']>=[];
function extract(sql:string,name:string,delimiter='$function$;'){const start=sql.indexOf('create or replace function '+name+'(');if(start<0)throw Error(name);return sql.slice(start,sql.indexOf(delimiter,start)+delimiter.length);}
async function setup(patch=true,seedInvoice=true){const {db}=await createInvoiceLifecycleDatabase();opened.push(db);await db.exec('begin');
 const roles=read('20260831164442_remove_authenticator_requirement');for(const name of ['is_tenant_admin','is_tenant_operator_or_admin'])await db.exec(extract(roles,'public.'+name));
 await db.exec(`create schema if not exists finance_private;create schema if not exists private;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table if not exists public.client_portal_access(user_id uuid,tenant_id uuid,active boolean);grant usage on schema finance_private to authenticated;`);
 const foundation=read('20260909212104_finance_ledger_foundation');const start=foundation.indexOf('create function finance_private.can_access(');await db.exec(foundation.slice(start,foundation.indexOf('create table public.finance_movements',start)));
 const boundary=read('20260909235237_finance_legacy_rpc_boundary');await db.exec(boundary.slice(0,boundary.indexOf('-- Wrap')));
 const context=read('20260910131125_active_tenant_auth_context');for(const name of ['user_can_access_tenant','request_tenant_id','is_request_tenant_member'])await db.exec(extract(context,'private.'+name));
 await db.exec(read('20260910140823_require_matching_active_tenant_claim'));await db.exec(read('20260910224136_finance_active_workspace_access'));
 await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)",[i.otherTenant,i.operator]);
 await claim(db,i.tenant);const scenario=seedInvoice?await createInvoiceScenario(db):{report:(await createClosingWithClient(db)).report.id,invoice:null,receivable:null};if(patch){await db.exec(readers);await db.exec(writer);}return {db,...scenario};}
async function claim(db:typeof opened[number],tenant:string|null,header=tenant){await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.headers',$2,true)",[JSON.stringify({role:'authenticated',...(tenant?{active_tenant_id:tenant}:{})}),JSON.stringify(header?{'x-agvlog-tenant-id':header}:{})]);}
afterEach(async()=>{for(const db of opened.splice(0)){await db.exec('rollback');await db.close();}});
async function calls(s:Awaited<ReturnType<typeof setup>>){return [
 ['select get_receivable_financial_context($1,$2)',[i.tenant,s.receivable]],
 ['select get_client_invoice_action_context($1,$2)',[i.tenant,s.invoice]],
 ['select list_client_invoice_financials($1)',[i.tenant]],
 ['select get_client_invoice_creation_context($1,null,$2::jsonb)',[i.tenant,JSON.stringify(await manualInvoiceDraft(s.db))]],
 ] as Array<[string,unknown[]]>;}
it('reproduces cross-company reads before the patch, then protects all four real readers',async()=>{const s=await setup(false);const queries=await calls(s);await claim(s.db,i.otherTenant);for(const [sql,args]of queries)await expect(operationRpc(s.db,sql,args)).resolves.toBeDefined();await s.db.exec(readers);await s.db.exec(writer);
 for(const [sql,args]of queries)await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});
 await claim(s.db,i.tenant);for(const [sql,args]of queries)await expect(operationRpc(s.db,sql,args)).resolves.toBeDefined();
 for(const [tenant,header]of [[null,i.tenant],[i.tenant,i.otherTenant]] as Array<[string|null,string]>){await claim(s.db,tenant,header);await expect(operationRpc(s.db,queries[0][0],queries[0][1])).rejects.toMatchObject({code:'42501'});}
});
it('keeps real invoice command and replay in the active company, denies other company and mixed driver',async()=>{const s=await setup();const payload=await invoiceActionPayload(s.db,s.invoice!,'mark_sent');Object.assign(payload,{channel:'QA',sent_to:'Cliente QA'});const ack=await invoiceCommand(s.db,payload);expect(await invoiceCommand(s.db,payload)).toEqual(ack);
 await claim(s.db,i.otherTenant);await expect(invoiceCommand(s.db,payload)).rejects.toMatchObject({code:'42501'});await claim(s.db,i.tenant);
 await s.db.query('update drivers set user_id=$1,active=true where tenant_id=$2',[i.operator,i.tenant]);
 for(const [sql,args]of await calls(s))await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});await expect(invoiceCommand(s.db,payload)).rejects.toMatchObject({code:'42501'});
 expect((await s.db.query('select count(*)::int n from client_invoice_commands where request_id=$1',[payload.request_id])).rows[0]).toEqual({n:1});
});
it('preserves staged false and rejects ACL drift atomically',async()=>{const s=await setup(false);await s.db.exec('savepoint patch;grant execute on function public.list_client_invoice_financials(uuid) to service_role');await expect(s.db.exec(readers)).rejects.toThrow('finance_company_read_contract_changed');await s.db.exec('rollback to savepoint patch');
 await s.db.exec(readers);await s.db.exec(writer);await s.db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$");for(const [sql,args]of await calls(s))await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});
});
const closingBoundary=read('20260911025737_finance_closing_active_company_boundary');
it('protects closing readers, draft replay, trip editing and action replay while retaining the real journey',async()=>{const s=await setup(false,false);await s.db.exec(closingBoundary);
 const row=(await s.db.query<{id:string;expected:unknown}>(`select id,jsonb_build_object('km_initial',km_initial,'km_final',km_final,'fuel_liters',fuel_liters,'fuel_unit_price',fuel_unit_price,'vehicle_plate',vehicle_plate,'driver_name',driver_name,'departure_at',departure_at,'arrival_at_ts',arrival_at_ts,'route_label',route_label,'route_complement',route_complement) expected from closing_report_items where closing_report_id=$1 order by id limit 1`,[s.report])).rows[0];
 const draft=await closingDraftPayload(s.db);draft.request_id='cf000000-0000-4000-8000-000000009001';const drafted=await createClosingDraft(s.db,draft);expect(await createClosingDraft(s.db,draft)).toEqual(drafted);
 const queries:Array<[string,unknown[]]>=[['select get_closing_report_sources($1,$2::jsonb)',[i.tenant,JSON.stringify(closingSourceFilters)]],['select get_closing_report_action_context($1,$2)',[i.tenant,s.report]],['select update_closing_report_trip_fields($1,$2,$3,$4::jsonb,$5::jsonb)',[i.tenant,s.report,row.id,JSON.stringify(row.expected),JSON.stringify({route_complement:'Conferido QA'})]]];
 for(const [sql,args]of queries)await expect(operationRpc(s.db,sql,args)).resolves.toBeDefined();const action=await closingActionPayload(s.db,s.report);const ack=await closingAction(s.db,action);expect(await closingAction(s.db,action)).toEqual(ack);
 await claim(s.db,i.otherTenant);for(const [sql,args]of queries)await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});await expect(createClosingDraft(s.db,draft)).rejects.toMatchObject({code:'42501'});await expect(closingAction(s.db,action)).rejects.toMatchObject({code:'42501'});
 await claim(s.db,i.tenant);await s.db.query('update drivers set user_id=$1,active=true where tenant_id=$2',[i.operator,i.tenant]);for(const [sql,args]of queries)await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});await expect(createClosingDraft(s.db,draft)).rejects.toMatchObject({code:'42501'});await expect(closingAction(s.db,action)).rejects.toMatchObject({code:'42501'});
});
it('rejects closing body drift before preserving a staged false gate',async()=>{const s=await setup(false,false);await s.db.exec('savepoint closing_patch');await s.db.exec(`do $$declare definition text;begin select pg_get_functiondef('public.get_closing_report_sources(uuid,jsonb)'::regprocedure) into definition;execute replace(definition,'closing_sources_invalid_filters','changed_source_contract');end$$`);await expect(s.db.exec(closingBoundary)).rejects.toThrow('finance_company_closing_contract_changed');await s.db.exec('rollback to savepoint closing_patch');await s.db.exec(closingBoundary);
 const action=await closingActionPayload(s.db,s.report);await s.db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$");await expect(closingAction(s.db,action)).rejects.toMatchObject({code:'42501'});
});

it('keeps billable-source evidence readable only in the active finance company without fiscal dispatch',async()=>{const s=await setup();
 const baseline=read('20260824224152_baseline');const ddl=baseline.match(/CREATE TABLE public\.hub_fiscal_emissions \([\s\S]*?\n\);/)?.[0];if(!ddl)throw Error('Missing real fiscal ledger DDL');await s.db.exec(ddl);
 const source=read('20260831124505_fiscal_emission_readiness');const start=source.indexOf('create function public.fiscal_source_is_billable('),end=source.indexOf('grant execute on function public.filter_billable_fiscal_sources(uuid,text,uuid[]) to authenticated;',start)+'grant execute on function public.filter_billable_fiscal_sources(uuid,text,uuid[]) to authenticated;'.length;await s.db.exec(source.slice(start,end));
 const doc='ce200000-0000-4000-8000-000000000001';await s.db.query("insert into cte_documents(id,tenant_id,cte_number,freight_value,status,sefaz_status,sefaz_environment,is_voided) values($1,$2,'EXISTING-QA',100,'authorized','authorized','production',false)",[doc,i.tenant]);
 await s.db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,hub_document_id,cte_document_id,sync_attempts,created_at,updated_at) values(gen_random_uuid(),$1,'cte','production','authorized','existing-provider-evidence',$2,0,clock_timestamp(),clock_timestamp())",[i.tenant,doc]);
 const sql="select filter_billable_fiscal_sources($1,'cte_document',$2::uuid[]) ids",args=[i.tenant,[doc]];
 await claim(s.db,i.otherTenant);expect((await operationRpc(s.db,sql,args)).rows[0]).toEqual({ids:[doc]});await s.db.exec(read('20260911030051_finance_billable_sources_active_company_boundary'));await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});
 await claim(s.db,i.tenant);expect((await operationRpc(s.db,sql,args)).rows[0]).toEqual({ids:[doc]});await s.db.query('update drivers set user_id=$1,active=true where tenant_id=$2',[i.operator,i.tenant]);await expect(operationRpc(s.db,sql,args)).rejects.toMatchObject({code:'42501'});
 expect((await s.db.query("select has_function_privilege('service_role','public.filter_billable_fiscal_sources(uuid,text,uuid[])','execute') allowed")).rows[0]).toEqual({allowed:false});
});
