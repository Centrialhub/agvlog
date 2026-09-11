import {supabase} from '@/integrations/supabase/client';
import {statementCoverageSchema,coveragePendingSchema,coverageApprovalResultSchema,coverageReversalResultSchema,type CoveragePending} from './statementCoverageContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>;
export class CoverageRejectedError extends Error {}
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await (supabase.rpc as unknown as Rpc)(name,args);if(error){if(['22023','23514','23505','40001','42501','55000'].includes(error.code||''))throw new CoverageRejectedError(error.message);throw new Error(error.message);}return data;}
export async function readStatementCoverage(tenant:string,account:string,from:string,to:string){const data=statementCoverageSchema.parse(await rpc('get_finance_statement_coverage_review',{_tenant_id:tenant,_account_id:account,_from:from,_to:to}));if(data.tenant_id!==tenant||data.account_id!==account||data.from!==from||data.to!==to)throw new Error('Cobertura fora do contexto.');return data;}
export async function submitStatementCoverage(pending:CoveragePending){coveragePendingSchema.parse(pending);const {command}=pending;
 const raw=await rpc(pending.kind==='approve'?'record_finance_statement_coverage_approval':'reverse_finance_statement_coverage_approval',{_payload:command});
 const result=pending.kind==='approve'?coverageApprovalResultSchema.parse(raw):coverageReversalResultSchema.parse(raw);
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||(pending.kind==='approve'&&(!('revision' in result)||result.revision!==pending.command.revision))||(pending.kind==='reverse'&&result.approval_id!==pending.command.approval_id))throw new Error('Confirmação fora da cobertura.');return result;
}
