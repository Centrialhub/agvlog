import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildExpenseBatch, distributeExpenseMovement, expenseBatchDraftSchema, newExpenseLine, type ExpenseBatchDraft, type FinanceOption } from '@/lib/financial/expenseBatchContract';
import { FinanceRejectedError, recordExpenseBatch } from '@/lib/financial/ledgerClient';
import { financeError, formatFinanceCents, parseFinanceAmount } from '@/lib/financial/ledgerContract';
import { FinanceOptionPicker } from './FinanceOptionPicker';
import { ExpenseBatchLine } from './ExpenseBatchLine';
import { repeatExpenseLineDetails, expenseErrorField } from '@/lib/financial/expenseBatchEntryUx';

const savedSchema = z.object({draft:expenseBatchDraftSchema,request:z.string().uuid().nullable()});
function restore(key:string):{saved:z.infer<typeof savedSchema>;error:boolean} {
  const empty:z.infer<typeof savedSchema>={request:null,draft:{context:'trip',trip:null,description:'Gastos conferidos no retorno',reason:'Conferência dos gastos e comprovantes',lines:[newExpenseLine('trip')]}};
  try {
    const raw=sessionStorage.getItem(key);if(raw===null)return {saved:empty,error:false};
    const parsed=savedSchema.safeParse(JSON.parse(raw));if(parsed.success)return {saved:parsed.data,error:false};
  }catch{/* Keep the original storage untouched when recovery cannot be verified. */}
  return {saved:empty,error:true};
}
export function ExpenseBatchDialog({tenant,actor,onClose,onRecorded}:{tenant:string;actor:string;onClose:()=>void;onRecorded:()=>void}) {
  const key=`finance-expense-batch:${tenant}:${actor}`;
  const [restored]=useState(()=>restore(key));
  const [saved,setSaved]=useState(restored.saved),[busy,setBusy]=useState(false),[uploadBusy,setUploadBusy]=useState(false);
  const sending=useRef(false),body=useRef<HTMLDivElement>(null);
  const [detailsExpanded,setDetailsExpanded]=useState(true),[focusTarget,setFocusTarget]=useState<{id:string;field:string}|null>(null);
  const [error,setError]=useState(''),[storageFailed,setStorageFailed]=useState(false),[review,setReview]=useState(false);
  const [sharedMovement,setSharedMovement]=useState<FinanceOption|null>(null);
  const draft=saved.draft, locked=busy||uploadBusy||!!saved.request||restored.error;
  useEffect(()=>{if(restored.error)return;try{sessionStorage.setItem(key,JSON.stringify(saved));setStorageFailed(false);}catch{setStorageFailed(true);}},[key,saved,restored.error]);
  useEffect(()=>{if(!focusTarget)return;const timer=window.setTimeout(()=>{const section=body.current?.querySelector(`[data-expense-id="${focusTarget.id}"]`);const control=body.current?.querySelector<HTMLElement>(focusTarget.id?`[data-expense-id="${focusTarget.id}"] [aria-label^="${focusTarget.field} "]`:`[data-add-expense]`)||Array.from(section?.querySelectorAll(`button`)||[]).find(button=>button.textContent?.trim().startsWith(`${focusTarget.field} `));control?.focus();setFocusTarget(null);},0);return()=>window.clearTimeout(timer);},[focusTarget]);
  const change=(next:ExpenseBatchDraft)=>{setSaved(old=>({...old,draft:next}));setReview(false);};
  function addLine(after?:string,repeat=false){if(locked||draft.lines.length>=200)return;const index=after?draft.lines.findIndex(line=>line.id===after):draft.lines.length-1,source=draft.lines[index],line=repeat&&source?repeatExpenseLineDetails(source,draft.context):newExpenseLine(draft.context),lines=[...draft.lines];lines.splice(index+1,0,line);change({...draft,lines});setFocusTarget({id:line.id,field:repeat?'Valor':'Categoria'});}
  function removeLine(id:string){if(locked)return;const index=draft.lines.findIndex(line=>line.id===id),lines=draft.lines.filter(line=>line.id!==id);change({...draft,lines});const next=lines[Math.min(index,lines.length-1)];setFocusTarget({id:next?.id||'',field:'Categoria'});}
  const total=draft.lines.reduce((sum,line)=>sum+BigInt(parseFinanceAmount(line.amount)||0),0n);
  const movements=new Map<string,{label:string;available:bigint;used:bigint}>();
  for(const line of draft.lines)for(const a of line.allocations){const previous=movements.get(a.movement.id);movements.set(a.movement.id,{
    label:a.movement.label,available:BigInt(a.movement.remaining_cents||0),used:(previous?.used||0n)+BigInt(parseFinanceAmount(a.amount)||0),
  });}
  const allocated=[...movements.values()].reduce((sum,m)=>sum+m.used,0n);
  function check() {
    try{buildExpenseBatch(draft,tenant,saved.request||crypto.randomUUID());setError('');setReview(true);}
    catch(cause){const message=cause instanceof Error?cause.message:'Revise os gastos.';setError(message);setDetailsExpanded(true);const match=/^Gasto (\d+):/.exec(message),line=match?draft.lines[Number(match[1])-1]:undefined;if(line){const field=expenseErrorField(line,message);setFocusTarget({id:line.id,field});}}
  }
  async function submit() {
    if(sending.current||uploadBusy||storageFailed||restored.error)return;
    let command;
    const request=saved.request||crypto.randomUUID();
    try{command=buildExpenseBatch(draft,tenant,request);}catch(cause){setError(cause instanceof Error?cause.message:'Revise os gastos.');return;}
    const attempt={draft,request};
    try{sessionStorage.setItem(key,JSON.stringify(attempt));}catch{setStorageFailed(true);return;}
    sending.current=true;setSaved(attempt);setBusy(true);setError('');
    try{await recordExpenseBatch(command);sessionStorage.removeItem(key);onRecorded();}
    catch(cause){setError(financeError(cause));if(cause instanceof FinanceRejectedError&&!saved.request){setSaved(old=>({...old,request:null}));setReview(false);}}
    finally{sending.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy&&!uploadBusy)onClose();}}>
    <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-6xl" onInteractOutside={e=>{if(busy||uploadBusy)e.preventDefault();}}>
      <DialogHeader><DialogTitle>Conferir gastos em lote</DialogTitle><DialogDescription>Registre cada gasto e vincule os valores aos envios existentes. Este lançamento não realiza pagamentos.</DialogDescription></DialogHeader>
      <div className="space-y-4" ref={body}>
        <fieldset disabled={locked} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Origem dos gastos<select aria-label="Origem dos gastos" className="h-10 w-full rounded border bg-background" value={draft.context}
            onChange={e=>{const context=e.target.value as ExpenseBatchDraft['context'];setSharedMovement(null);change({...draft,context,trip:null,
              lines:draft.lines.map(line=>({...line,payeeType:context==='trip'?'driver':'supplier'}))});}}>
            <option value="trip">Viagem</option><option value="office">Sede / escritório</option><option value="personnel">Pessoal / folha</option><option value="maintenance">Manutenção</option><option value="other">Outros</option></select></label>
            <label className="text-sm">Descrição do lote<Input aria-label="Descrição do lote" value={draft.description} onChange={e=>change({...draft,description:e.target.value})}/></label>
            <label className="text-sm">Motivo / conferência<Input aria-label="Motivo da conferência" value={draft.reason} onChange={e=>change({...draft,reason:e.target.value})}/></label>
          </div>
          {draft.context==='trip'&&<FinanceOptionPicker tenant={tenant} actor={actor} kind="trips" label="Viagem finalizada" value={draft.trip} onChange={trip=>change({...draft,trip})}/>}
          <div className="space-y-2 rounded border p-3"><p className="text-sm">Um único envio cobriu vários gastos? Selecione-o e distribua o saldo entre os gastos abaixo, na ordem exibida.</p>
            <FinanceOptionPicker tenant={tenant} actor={actor} kind="movements" trip={draft.context==='trip'?draft.trip?.id||null:null} label="Envio compartilhado" value={sharedMovement} onChange={setSharedMovement}/>
            <Button type="button" variant="outline" disabled={!sharedMovement} onClick={()=>{try{change(distributeExpenseMovement(draft,sharedMovement!));setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Revise os vínculos.');}}}>Distribuir saldo entre os gastos</Button>
          </div>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border bg-background p-3"><Button type="button" data-add-expense variant="outline" disabled={draft.lines.length>=200} onClick={()=>addLine()}>Adicionar gasto</Button><Button type="button" variant="outline" onClick={()=>setDetailsExpanded(!detailsExpanded)}>{detailsExpanded?'Recolher detalhes dos gastos':'Expandir detalhes dos gastos'}</Button><span className="text-sm">{draft.lines.length}/200 gastos · Total {formatFinanceCents(total.toString())} · Vinculado {formatFinanceCents(allocated.toString())} · Complemento {formatFinanceCents((total>allocated?total-allocated:0n).toString())}</span>{allocated>total&&<span className="text-destructive">Excesso vinculado: {formatFinanceCents((allocated-total).toString())}</span>}</div>
          <p className="text-sm text-muted-foreground">Ctrl+Enter em um gasto adiciona o próximo. Reutilizar dados mantém categoria, descrição, data e favorecido; valor, comprovante, documento, entrega e vínculos devem ser conferidos novamente.</p>
          {draft.lines.map((line,index)=><ExpenseBatchLine key={line.id} tenant={tenant} actor={actor} trip={draft.context==='trip'?draft.trip?.id||null:null} line={line} index={index}
            onChange={next=>change({...draft,lines:draft.lines.map(current=>current.id===next.id?next:current)})}
            onRemove={()=>removeLine(line.id)} onUploadBusy={setUploadBusy} detailsExpanded={detailsExpanded} revealDetails={focusTarget?.id===line.id} onRepeat={draft.lines.length<200?()=>addLine(line.id,true):undefined} onAddAfter={()=>addLine(line.id)}/>)}
        </fieldset>
        <div className="rounded-lg bg-muted p-4 text-sm" aria-label="Resumo do lote"><p>{draft.lines.length} gastos · Total {formatFinanceCents(total.toString())} · Vinculado {formatFinanceCents(allocated.toString())}</p>
          {allocated>total&&<p className="text-destructive">Excesso vinculado: {formatFinanceCents((allocated-total).toString())}. Revise os vínculos antes de registrar.</p>}<p>Complementos a pagar: {formatFinanceCents((total>allocated?total-allocated:0n).toString())}</p>
          {[...movements.entries()].map(([id,m])=><p key={id}>{m.label}: utilizado {formatFinanceCents(m.used.toString())}; saldo sem composição {formatFinanceCents((m.available-m.used).toString())}</p>)}
          <p className="mt-2">Saldo sem composição permanece pendente. A confirmação bancária será feita pelo extrato.</p>
        </div>
        {error&&<p role="alert">{error}</p>}{restored.error&&<p role="alert">Não foi possível recuperar o lote preservado. O conteúdo original foi mantido e novos envios estão bloqueados. Confira o histórico antes de recuperar este pedido com o suporte.</p>}{storageFailed&&<p role="alert">Não foi possível preservar o rascunho neste navegador. O envio está bloqueado para evitar perda de rastreabilidade.</p>}
        {saved.request&&!busy&&<p role="status">Pedido preservado. Reenviar usa a mesma identificação e não cria um segundo lote.</p>}
        {review&&<p role="status">Revise os gastos e vínculos acima. Ao registrar, eventuais complementos entram em contas a pagar e cada descarga válida gera uma conta a receber do fornecedor da entrega.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy||uploadBusy} onClick={onClose}>Fechar e guardar rascunho</Button>
          {review||saved.request?<Button type="button" disabled={busy||uploadBusy||storageFailed||restored.error} onClick={()=>void submit()}>{busy?'Registrando…':saved.request?'Reenviar mesmo lote':'Registrar lote conferido'}</Button>
            :<Button type="button" disabled={locked||storageFailed} onClick={check}>Revisar lote</Button>}</div>
      </div>
    </DialogContent>
  </Dialog>;
}
