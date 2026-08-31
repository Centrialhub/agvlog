import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createClosingSourcesDatabase,closingSources,closingSourceFilters} from './closingSourcesDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
export const closingDraftMigration='20260830165149_make_closing_drafts_atomic.sql';
export const closingDraftSql=()=>readFileSync('supabase/migrations/'+closingDraftMigration,'utf8');
export async function installClosingDraftFixture(db:PGlite){
 const tables=['closing_reports','closing_report_items','closing_report_summary_lines','closing_report_history','closing_report_sequences','closing_report_payments','client_invoices','receivables'];
 for(const table of tables){
  const found=(await db.query<{exists:boolean}>('select to_regclass($1) is not null as exists',['public.'+table])).rows[0].exists;
  if(!found){const declaration=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];
   if(!declaration)throw new Error('Missing local baseline '+table);await db.exec(declaration);
   for(const match of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\n    ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(match[0]);
   await db.exec('alter table public.'+table+' add primary key('+ (table==='closing_report_sequences'?'tenant_id,sequence_year':'id')+')');
  }
 }
 for(const table of ['clients','vehicles','drivers','cte_documents','client_invoices','receivables','loads','fiscal_documents']){
  await db.exec('create unique index if not exists qa_closing_'+table+'_tenant_key on public.'+table+'(tenant_id,id)');
 }
 // Real checked-in financial FK/RPC migration, not stubbed business writers.
 await db.exec(readFileSync('supabase/migrations/20260828130909_harden_closing_report_financial_contract.sql','utf8'));
 for(const name of ['is_tenant_member','is_tenant_admin','close_closing_report','cancel_closing_report','reopen_closing_report']){
  const marker='CREATE OR REPLACE FUNCTION public.'+name+'(';const start=baseline.indexOf(marker);
  const end=baseline.indexOf('$function$;',start)+12;await db.exec(baseline.slice(start,end));
 }
 for(const table of tables.filter(table=>table.startsWith('closing_'))){
  await db.exec('alter table public.'+table+' enable row level security;grant select,insert,update,delete on public.'+table+' to authenticated,service_role;');
  for(const policy of baseline.matchAll(new RegExp('CREATE POLICY [^\\n]+ ON public\\.'+table+' [^\\n]+;','g')))await db.exec(policy[0]);
 }
 await db.exec('grant execute on function public.next_closing_report_number(uuid,date),public.close_closing_report(uuid),public.cancel_closing_report(uuid,text),public.reopen_closing_report(uuid,text) to authenticated;');
}
export async function createClosingDraftDatabase(){
 const value=await createClosingSourcesDatabase();await installClosingDraftFixture(value.db);await value.db.exec(closingDraftSql());return value;
}
export async function closingDraftPayload(db:PGlite,allocation='per_nf'){
 const sources=await closingSources(db) as {revision:string};return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:'cf000000-0000-4000-8000-000000000001',
  mode:'system',reason:'Conferência QA antes de criar fechamento',header:{title:'Fechamento QA',client_id:null,payer_client_id:null,report_type:'custom',report_model:'detailed',period_start:'2026-08-01',period_end:'2026-08-31'},
  system:{filters:closingSourceFilters,options:{allocation,only_with_cte:false},revision:sources.revision}};
}
export async function createClosingDraft(db:PGlite,payload:unknown){
 return (await operationRpc<{result:{report:{id:string;closing_number:string;status:string};item_count:number;summary_count:number;totals:Record<string,number>}}>(db,
  'select create_closing_report_draft($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
}
