import {uploadArtifactSchema,uploadArtifactStatus,type UploadArtifact} from './uploadArtifactContract';
import {FinanceRejectedError} from './ledgerClient';
import {pendingStatementSchema,statementIntakeResultSchema,statementVerificationResultSchema,type PendingStatement,type StatementVerificationResult} from './statementImportContract';
interface Dependencies {
  store:{load:(tenant:string,actor:string)=>Promise<PendingStatement|null>;save:(row:PendingStatement)=>Promise<void>;remove:(tenant:string,actor:string)=>Promise<void>};
  lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;assertContext:()=>void;
  originalReady:(row:PendingStatement)=>Promise<boolean>;upload:(row:PendingStatement,file:File)=>Promise<void|UploadArtifact>;
  intake:(row:PendingStatement)=>Promise<unknown>;verify:(row:PendingStatement)=>Promise<unknown>;
}
export function createStatementImportWorkflow(deps:Dependencies){
  let inFlight:Promise<StatementVerificationResult>|null=null;
  let flightScope='';
  async function execute(tenant:string,actor:string,initial?:PendingStatement,file?:File){
    return deps.lock(`finance-statement:${tenant}:${actor}`,async()=>{
      deps.assertContext();let row=await deps.store.load(tenant,actor);deps.assertContext();
      if(row&&(row.tenant!==tenant||row.actor!==actor||row.command.tenant_id!==tenant))throw new Error('Recuperação pertence a outro contexto.');
      if(row&&initial)throw new Error('Recupere o extrato pendente antes de iniciar outro.');
      if(!row){if(!initial)throw new Error('Não há extrato pendente nesta sessão.');row=pendingStatementSchema.parse(initial);
        if(row.tenant!==tenant||row.actor!==actor||row.command.tenant_id!==tenant||row.phase!=='upload'||row.uncertain)throw new Error('Contexto de importação inválido.');
        await deps.store.save(row);deps.assertContext();}
      if(row.phase==='rejected')throw new Error('Este pedido foi rejeitado. Revise e descarte o pedido rejeitado antes de preparar outro.');
      if(row.phase==='upload'){
        const ready=await deps.originalReady(row);deps.assertContext();
        if(!ready){if(!file)throw new Error('Selecione novamente o mesmo arquivo original para concluir o envio.');
          const artifact=await deps.upload(row,file);deps.assertContext();
          if(row.upload_mode==='quarantine_v2'){
            const validated=uploadArtifactSchema.parse(artifact);
            if(validated.tenant_id!==tenant||validated.actor_id!==actor||validated.request_id!==row.command.request_id||validated.source_type!=='bank_account'||validated.source_id!==row.command.bank_account_id||validated.original.sha256!==row.command.file_hash||validated.original.size_bytes!==row.file_size)throw new Error('Artefato fora do pedido preservado.');
            row={...row,artifact:validated};await deps.store.save(row);deps.assertContext();
            if(!validated.usable)throw new Error(uploadArtifactStatus(validated));
          }}
        row={...row,phase:'intake',uncertain:false};await deps.store.save(row);deps.assertContext();
      }
      if(row.phase==='intake'){
        const wasUncertain=row.uncertain;row={...row,uncertain:true};await deps.store.save(row);deps.assertContext();
        try{
          const receipt=statementIntakeResultSchema.parse(await deps.intake(row));deps.assertContext();
          if(receipt.tenant_id!==tenant||receipt.request_id!==row.command.request_id
            ||Object.values(receipt.counts).reduce((sum,n)=>sum+(n??0),0)!==row.command.rows.length)throw new Error('Resposta da importação incompatível com o pedido.');
          row={...row,receipt,phase:'verify',uncertain:false};await deps.store.save(row);deps.assertContext();
        }catch(error){
          if(error instanceof FinanceRejectedError&&!wasUncertain){row={...row,phase:'rejected',uncertain:false};await deps.store.save(row);}
          throw error;
        }
      }
      deps.assertContext();const result=statementVerificationResultSchema.parse(await deps.verify(row));deps.assertContext();
      if(result.tenant_id!==tenant||result.request_id!==row.verification_request||result.import_id!==row.receipt?.import_id)throw new Error('Resposta da conferência incompatível com o extrato.');
      await deps.store.remove(tenant,actor);return result;
    });
  }
  return {
    run(tenant:string,actor:string,initial?:PendingStatement,file?:File){
      if(inFlight){if(flightScope!==`${tenant}:${actor}`)return Promise.reject(new Error('Há uma importação em outro contexto.'));return inFlight;}
      flightScope=`${tenant}:${actor}`;
      const work=execute(tenant,actor,initial,file);inFlight=work;
      void work.finally(()=>{if(inFlight===work)inFlight=null;}).catch(()=>{});return work;
    },
    abandon(tenant:string,actor:string){return deps.lock(`finance-statement:${tenant}:${actor}`,async()=>{
      deps.assertContext();const row=await deps.store.load(tenant,actor);deps.assertContext();
      if(row&&((row.phase!=='upload'&&row.phase!=='rejected')||row.uncertain))throw new Error('A importação pode ter sido registrada. Recupere a confirmação antes de descartar.');
      await deps.store.remove(tenant,actor);
    });},
  };
}
