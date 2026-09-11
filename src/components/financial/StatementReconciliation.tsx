import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ZodError} from 'zod';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {FinanceRejectedError,readReconciliationContext,reconcileBankGroup} from '@/lib/financial/ledgerClient';
import {checkReconciliation,reconciliationSavedSchema,reconciliationError,type ReconciliationSaved,type ReconciliationOption} from '@/lib/financial/reconciliationContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {ReconciliationSelection} from './ReconciliationSelection';
export function StatementReconciliation({tenant,actor,statement}:{tenant:string;actor:string;statement:string}){
 const key=`finance-reconciliation:${tenant}:${actor}:${statement}`,qc=useQueryClient();
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {saved:null,error:''};
  const saved=reconciliationSavedSchema.parse(JSON.parse(raw));if(saved.actor_id!==actor||saved.import_id!==statement||saved.command.tenant_id!==tenant)throw new Error('scope');checkReconciliation(saved);
  return {saved,error:''};}catch{return {saved:null,error:'Não foi possível recuperar a conciliação anterior. Não envie outro pedido nesta sessão.'};}});
 const [open,setOpen]=useState(!!restored.saved||!!restored.error),[pending,setPending]=useState<ReconciliationSaved|null>(restored.saved),[preview,setPreview]=useState<ReconciliationSaved|null>(null);
 const [movements,setMovements]=useState<ReconciliationOption[]>([]),[entries,setEntries]=useState<ReconciliationOption[]>([]);
 const [reason,setReason]=useState(''),[accountEvidence,setAccountEvidence]=useState(''),[error,setError]=useState(restored.error),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const sending=useRef(false),live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function prepare(){
  if(sending.current||restored.error)return;sending.current=true;setBusy(true);setError('');
  try{const context=await readReconciliationContext(tenant,movements.map(row=>row.id),entries.map(row=>row.id));if(!live.current)return;
   const saved=reconciliationSavedSchema.parse({actor_id:actor,import_id:statement,context,command:{version:1,tenant_id:tenant,request_id:crypto.randomUUID(),movement_ids:movements.map(row=>row.id),bank_entry_ids:entries.map(row=>row.id),expected_revision:context.revision,reason,account_evidence:accountEvidence}});
   checkReconciliation(saved);setPreview(saved);
  }catch(cause){if(live.current)setError(cause instanceof ZodError?'Não foi possível validar a seleção. Atualize os dados e confira os motivos.':cause instanceof FinanceRejectedError?reconciliationError(cause):cause instanceof Error?cause.message:'Confira a seleção e os motivos.');}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 async function submit(){
  const saved=pending||preview;if(!saved||sending.current||restored.error)return;const uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify(saved));}catch{setError('Não foi possível preservar o pedido. Nenhuma confirmação foi enviada.');return;}
  sending.current=true;setBusy(true);setPending(saved);setPreview(null);setError('');
  try{const result=await reconcileBankGroup(saved.command);if(result.amount_cents!==checkReconciliation(saved))throw new Error('Confirmação com total incompatível');
   sessionStorage.removeItem(key);if(live.current){setPending(null);setMovements([]);setEntries([]);setReason('');setAccountEvidence('');setOpen(false);setNotice('Conciliação manual registrada, com responsável e evidências preservados. Nenhuma movimentação foi criada.');
    void invalidateAccountReview(qc,tenant);for(const prefix of ['finance-reconciliation-history','finance-reconciliation-options','finance-statement-lines','finance-statements','finance-audit'])void qc.invalidateQueries({queryKey:[prefix,tenant]});}
  }catch(cause){if(live.current){setError(reconciliationError(cause));if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);void qc.invalidateQueries({queryKey:['finance-reconciliation-options',tenant]});}catch{/* Keep request identity if cleanup fails. */}}}}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 const frozen=pending||preview;
 if(!open)return <div className="space-y-2">{notice&&<p role="status">{notice}</p>}<Button variant="outline" onClick={()=>{setOpen(true);setNotice('');}}>Conciliar lançamentos deste extrato</Button></div>;
 return <section aria-label="Conciliação manual do extrato" className="space-y-3 rounded border border-amber-600 p-4"><h2 className="font-semibold">Conciliação manual</h2>
  <p className="text-sm">A decisão ficará identificada como manual, com seu nome e justificativa. Confira a conta no arquivo original antes de confirmar. Esta operação não certifica a cobertura ou o saldo de todo o período.</p>
  {frozen?<><div className="rounded bg-muted p-3 text-sm"><p className="font-semibold">{frozen.context.accounts[0].name}</p>
   <p>{frozen.context.accounts[0].bank_name||'Banco não informado'} · Agência {frozen.context.accounts[0].branch_number||'não informada'} · Conta {frozen.context.accounts[0].account_number||'não informada'}</p>
   <p className="font-semibold">Total em cada lado: {formatFinanceCents(checkReconciliation(frozen))}</p>
   <h3 className="mt-2 font-medium">Lançamentos</h3>{frozen.context.movements.map(row=><p key={row.id}>{row.occurred_on} · {row.beneficiary_name} · {row.description} · {formatFinanceCents(row.amount_cents)}</p>)}
   <h3 className="mt-2 font-medium">Extrato</h3>{frozen.context.entries.map(row=><p key={row.id}>{row.posted_on} · {row.counterparty_name||'Contraparte não informada'} · {row.description} · {formatFinanceCents(row.amount_cents)}</p>)}
   <p className="mt-2">Conferência da conta: {frozen.command.account_evidence}</p><p>Justificativa: {frozen.command.reason}</p></div>
   {pending&&<p role="status">Pedido preservado. Recupere a confirmação com os mesmos dados.</p>}
   <Button disabled={busy} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma conciliação':'Confirmar conciliação manual'}</Button>
   {!pending&&<Button variant="outline" disabled={busy} onClick={()=>setPreview(null)}>Voltar à seleção</Button>}
  </>:<><div className="grid gap-3 lg:grid-cols-2"><ReconciliationSelection tenant={tenant} actor={actor} statement={statement} kind="movements" selected={movements} onChange={setMovements} disabled={busy||!!restored.error}/>
   <ReconciliationSelection tenant={tenant} actor={actor} statement={statement} kind="entries" selected={entries} onChange={setEntries} disabled={busy||!!restored.error}/></div>
   <label className="block">Como conferiu a conta no original?<Textarea disabled={busy} maxLength={2000} value={accountEvidence} onChange={e=>setAccountEvidence(e.target.value)}/></label>
   <label className="block">Justificativa da conciliação<Textarea disabled={busy} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <Button disabled={busy||!!restored.error||!movements.length||!entries.length||reason.trim().length<10||accountEvidence.trim().length<10} onClick={()=>void prepare()}>Conferir seleção e totais</Button>
  </>}{error&&<p role="alert">{error}</p>}
 </section>;
}
