import {describe,expect,it,vi} from 'vitest';
import {createStatementImportWorkflow} from '@/lib/financial/statementImportWorkflow';
import {FinanceRejectedError} from '@/lib/financial/ledgerClient';
import type {PendingStatement} from '@/lib/financial/statementImportContract';
function setup(){
  const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),request=crypto.randomUUID(),verifyRequest=crypto.randomUUID(),importId=crypto.randomUUID();
  const initial:PendingStatement={version:1,tenant,actor,file_name:'extrato.csv',file_size:50,created_at:'2026-01-01T12:00:00Z',phase:'upload',uncertain:false,verification_request:verifyRequest,
    command:{version:1,tenant_id:tenant,request_id:request,bank_account_id:crypto.randomUUID(),file_hash:'a'.repeat(64),source_path:`${tenant}/imports/${'a'.repeat(64)}.csv`,currency:'BRL',parser_version:'mapped-csv-v1',
      mapping:{header_row:0,date_column:0,description_column:1,amount_column:2,date_format:'dmy',number_format:'br',delimiter:';'},period_start:'2026-01-01',period_end:'2026-01-31',reason:'Conferência do extrato',
      rows:[{posted_on:'2026-01-01',description:'PIX',amount_cents:-50000,bank_id:null,document_number:null,counterparty_name:null,counterparty_document:null,raw:{source_row:2,cells:['01/01/2026','PIX','-500,00']}}]}};
  let stored:PendingStatement|null=null;
  const store={load:vi.fn(async()=>stored?structuredClone(stored):null),save:vi.fn(async(row:PendingStatement)=>{stored=structuredClone(row);}),remove:vi.fn(async()=>{stored=null;})};
  const receipt={version:1,tenant_id:tenant,request_id:request,import_id:importId,counts:{new:1},source_verification:'pending',confirmed:true};
  const result={version:1,tenant_id:tenant,request_id:verifyRequest,import_id:importId,verification_id:crypto.randomUUID(),source_verification:'rows_match',account_coverage_verification:'pending',confirmed:true};
  const deps={store,lock:async<T>(_key:string,work:()=>Promise<T>)=>work(),assertContext:vi.fn(),originalReady:vi.fn().mockResolvedValue(false),upload:vi.fn().mockResolvedValue(undefined),
    intake:vi.fn().mockResolvedValue(receipt),verify:vi.fn().mockResolvedValue(result)};
  return {tenant,actor,initial,deps,receipt,result,file:new File(['original'],'extrato.csv'),workflow:createStatementImportWorkflow(deps)};
}
describe('statement import recoverable stages',()=>{
  it('retries an uncertain intake with the exact same command and never uploads twice',async()=>{
    const s=setup();s.deps.intake.mockRejectedValueOnce(new Error('reply lost')).mockResolvedValue(s.receipt);
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('reply lost');
    expect((await s.deps.store.load())?.uncertain).toBe(true);
    expect(await s.workflow.run(s.tenant,s.actor)).toEqual(s.result);
    expect(s.deps.upload).toHaveBeenCalledTimes(1);expect(s.deps.intake.mock.calls[0][0].command).toEqual(s.deps.intake.mock.calls[1][0].command);
    expect(await s.deps.store.load()).toBeNull();
  });
  it('resumes only verification after intake was confirmed',async()=>{
    const s=setup();s.deps.verify.mockRejectedValueOnce(new Error('verification reply lost')).mockResolvedValue(s.result);
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('verification reply lost');
    expect((await s.deps.store.load())?.phase).toBe('verify');await s.workflow.run(s.tenant,s.actor);
    expect(s.deps.intake).toHaveBeenCalledTimes(1);expect(s.deps.verify.mock.calls[0][0].verification_request).toBe(s.deps.verify.mock.calls[1][0].verification_request);
  });
  it('recovers a lost upload response by locating the preserved original without requiring the file again',async()=>{
    const s=setup();s.deps.upload.mockRejectedValueOnce(new Error('upload uncertain'));s.deps.originalReady.mockResolvedValueOnce(false).mockResolvedValue(true);
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('upload uncertain');await s.workflow.run(s.tenant,s.actor);
    expect(s.deps.upload).toHaveBeenCalledTimes(1);
  });
  it('does not send any mutation when the initial durable write fails',async()=>{
    const s=setup();s.deps.store.save.mockRejectedValueOnce(new Error('storage full'));
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('storage full');
    expect(s.deps.upload).not.toHaveBeenCalled();expect(s.deps.intake).not.toHaveBeenCalled();
  });
  it('permits abandoning a definitively rejected fresh request but preserves an uncertain one',async()=>{
    const s=setup();s.deps.intake.mockRejectedValue(new FinanceRejectedError('finance_invalid_statement'));
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow();expect((await s.deps.store.load())?.phase).toBe('rejected');
    await s.workflow.abandon(s.tenant,s.actor);expect(await s.deps.store.load()).toBeNull();
    const uncertain=setup();uncertain.deps.intake.mockRejectedValue(new Error('unknown'));
    await expect(uncertain.workflow.run(uncertain.tenant,uncertain.actor,uncertain.initial,uncertain.file)).rejects.toThrow();
    await expect(uncertain.workflow.abandon(uncertain.tenant,uncertain.actor)).rejects.toThrow('pode ter sido registrada');
  });
  it('does not accept a reply containing another import request',async()=>{
    const s=setup();s.deps.intake.mockResolvedValue({...s.receipt,request_id:crypto.randomUUID()});
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('incompatível');expect(s.deps.verify).not.toHaveBeenCalled();
  });
  it('stops after the active context changes during an intake response',async()=>{
    const s=setup();s.deps.intake.mockImplementation(async()=>{s.deps.assertContext.mockImplementation(()=>{throw new Error('session changed');});return s.receipt;});
    await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('session changed');expect(s.deps.verify).not.toHaveBeenCalled();
    expect(await s.deps.store.load()).not.toBeNull();
  });
});

it('keeps a quarantined artifact in durable recovery and never calls intake',async()=>{
 const s=setup();s.initial.upload_mode='quarantine_v2';
 s.deps.upload.mockResolvedValue({version:2,tenant_id:s.tenant,actor_id:s.actor,request_id:s.initial.command.request_id,artifact_id:crypto.randomUUID(),source_type:'bank_account',source_id:s.initial.command.bank_account_id,state:'quarantined',usable:false,derivative:null,issues:['format_requires_sanitization'],original:{sha256:s.initial.command.file_hash,size_bytes:s.initial.file_size,format:'xlsx',received:true}});
 await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('quarentena');
 expect(s.deps.intake).not.toHaveBeenCalled();expect(s.deps.verify).not.toHaveBeenCalled();expect((await s.deps.store.load())?.artifact?.state).toBe('quarantined');expect((await s.deps.store.load())?.phase).toBe('upload');
});
it('persists a confirmed derived artifact before entering the uncertain intake phase',async()=>{
 const s=setup();s.initial.upload_mode='quarantine_v2';
 const a={version:2,tenant_id:s.tenant,actor_id:s.actor,request_id:s.initial.command.request_id,artifact_id:crypto.randomUUID(),source_type:'bank_account',source_id:s.initial.command.bank_account_id,state:'validated_data',usable:true,issues:[],original:{sha256:s.initial.command.file_hash,size_bytes:s.initial.file_size,format:'csv',received:true},derivative:{bucket:'upload-validated',path:`${s.tenant}/${s.initial.command.request_id}/validated.json`,sha256:'b'.repeat(64),size_bytes:20,mime:'application/json',method:'strict-csv-matrix-v1',financial_mapping_required:true}};
 s.deps.upload.mockResolvedValue(a);s.deps.intake.mockRejectedValueOnce(new Error('reply lost'));
 await expect(s.workflow.run(s.tenant,s.actor,s.initial,s.file)).rejects.toThrow('reply lost');expect((await s.deps.store.load())?.artifact).toEqual(a);
 await s.workflow.run(s.tenant,s.actor);expect(s.deps.upload).toHaveBeenCalledTimes(1);expect(s.deps.intake.mock.calls[1][0].artifact).toEqual(a);
});