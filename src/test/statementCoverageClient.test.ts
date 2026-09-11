import {beforeEach,it,expect,vi} from 'vitest';
import {readStatementCoverage,submitStatementCoverage,CoverageRejectedError} from '@/lib/financial/statementCoverageClient';
import {statementCoverageSchema,coveragePendingSchema} from '@/lib/financial/statementCoverageContract';
import {tenant,account,context,approval,approvalId} from './statementCoverageFixture';
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));beforeEach(()=>rpc.mockReset());
const pending=coveragePendingSchema.parse({kind:'approve',command:{version:1,tenant_id:tenant,request_id:crypto.randomUUID(),account_id:account,from:context.from,to:context.to,revision:context.revision,reason:'Originais e período conferidos',originals_obtained_from_bank:true,complete_period_confirmed:true}});
it('reads scoped evidence and rejects foreign nested snapshots, reversal identity and false authenticity claims',async()=>{
 rpc.mockResolvedValue({data:context,error:null});expect(await readStatementCoverage(tenant,account,context.from,context.to)).toMatchObject({can_close:false,authenticity_status:'not_attested'});
 expect(statementCoverageSchema.safeParse({...context,approval:{...approval,snapshot:{...approval.snapshot,account_id:crypto.randomUUID()}}}).success).toBe(false);
 expect(statementCoverageSchema.safeParse({...context,history:[{...approval,reversal:{id:crypto.randomUUID(),tenant_id:tenant,approval_id:crypto.randomUUID(),actor_id:tenant,actor_name:'Ana',reason:'Correção motivada',created_at:'2026-02-02'}}]}).success).toBe(false);
 for(const override of [{can_close:true},{authenticity_status:'attested_by_bank'}])expect(statementCoverageSchema.safeParse({...context,...override}).success).toBe(false);
 rpc.mockResolvedValue({data:{...context,account_id:crypto.randomUUID()},error:null});await expect(readStatementCoverage(tenant,account,context.from,context.to)).rejects.toThrow();
});
it('sends only approval or reversal RPC and validates matching confirmation',async()=>{
 const response={version:1,tenant_id:tenant,request_id:pending.command.request_id,approval_id:approvalId,revision:context.revision,review_method:'reviewed_by_user',authenticity_status:'not_attested',confirmed:true,can_close:false};rpc.mockResolvedValue({data:response,error:null});await submitStatementCoverage(pending);expect(rpc).toHaveBeenCalledWith('record_finance_statement_coverage_approval',{_payload:pending.command});rpc.mockResolvedValue({data:{...response,revision:'other'},error:null});await expect(submitStatementCoverage(pending)).rejects.toThrow('Confirmação fora');
 const reverse=coveragePendingSchema.parse({kind:'reverse',command:{version:1,tenant_id:tenant,request_id:crypto.randomUUID(),approval_id:approvalId,reason:'Revisão incorreta identificada'}});rpc.mockResolvedValue({data:{version:1,tenant_id:tenant,request_id:reverse.command.request_id,approval_id:approvalId,reversal_id:crypto.randomUUID(),confirmed:true,can_close:false},error:null});await submitStatementCoverage(reverse);expect(rpc).toHaveBeenLastCalledWith('reverse_finance_statement_coverage_approval',{_payload:reverse.command});
});
it('distinguishes transactional rejection from uncertainty and refuses missing declarations',async()=>{
 expect(coveragePendingSchema.safeParse({...pending,command:{...pending.command,complete_period_confirmed:false}}).success).toBe(false);rpc.mockResolvedValue({data:null,error:{code:'40001',message:'finance_coverage_evidence_changed'}});await expect(submitStatementCoverage(pending)).rejects.toBeInstanceOf(CoverageRejectedError);rpc.mockResolvedValue({data:null,error:{code:'08006',message:'connection lost'}});try{await submitStatementCoverage(pending);}catch(e){expect(e).not.toBeInstanceOf(CoverageRejectedError);}
});
