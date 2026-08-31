import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createExpenseCreationDatabase} from './expenseCreationDatabase.ts';
import {operationIds as i} from './operationOutcomeDatabase.ts';
export const expenseMfaMigration='20260830231003_enforce_expense_creation_mfa.sql';
export const expenseMfaSql=()=>readFileSync('supabase/migrations/'+expenseMfaMigration,'utf8');
export async function installExpenseMfaFixture(db:PGlite){
 const sql=readFileSync('supabase/migrations/20260828210458_enforce_privileged_mfa_release.sql','utf8');
 await db.exec("create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;grant usage on schema auth to authenticated;");
 // Earlier finance fixtures used baseline helpers. Install the actual release
 // definitions, including is_tenant_admin; never simulate MFA with a stub.
 for(const name of ['is_tenant_member','is_tenant_admin','is_tenant_operator_or_admin','is_user_internal_role']){
  const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('$function$;',start)+11;
  if(start<0||end<11)throw new Error('Missing MFA release helper '+name);await db.exec(sql.slice(start,end));
 }
}
export async function expenseMfaDatabase(candidate=true){
 const value=await createExpenseCreationDatabase();await installExpenseMfaFixture(value.db);
 if(candidate)await value.db.exec(expenseMfaSql());return value;
}
export async function expenseMfaActor(db:PGlite,actor=i.operator,aal:string|null='aal1',extra:Record<string,unknown>={}){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[actor,JSON.stringify({...extra,...(aal===null?{}:{aal})})]);
}
export const expenseMfaRole=(db:PGlite,role:string,actor=i.operator)=>db.query('update tenant_memberships set role=$1,active=true where tenant_id=$2 and user_id=$3',[role,i.tenant,actor]);
