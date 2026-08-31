import {useId,useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useSettlementAdjustment} from '@/hooks/useSettlementAdjustment';
import {adjustmentAmountCents,settlementAdjustmentError,type SettlementAdjustmentContext,type SettlementAdjustmentInput} from '@/lib/financial/settlementAdjustmentCommands';
import {SettlementAdjustmentRecovery} from './SettlementAdjustmentRecoveryPanel';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
const money=(value:number|null)=>value===null?'Requer conciliação':(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function SettlementAdjustments({settlementId}:{settlementId:string}){const {currentTenant}=useTenant();const {user}=useAuth();
 return <AdjustmentEditor key={currentTenant?.id+':'+user?.id+':'+settlementId} settlementId={settlementId}/>;}
function AdjustmentEditor({settlementId}:{settlementId:string}){
 const api=useSettlementAdjustment(settlementId),prefix=useId();const current=api.query.isError?undefined:api.query.data;
 const [preview,setPreview]=useState<SettlementAdjustmentContext>(),[action,setAction]=useState<'add'|'remove'>('add'),[item,setItem]=useState<string|null>(null);
 const [nature,setNature]=useState<'credit'|'debit'>('credit'),[amount,setAmount]=useState(''),[description,setDescription]=useState(''),[reason,setReason]=useState('');
 const [notice,setNotice]=useState(''),[failed,setFailed]=useState(false);
 const pending=api.isPending||!!api.pending||!!api.recoveryError;
 const changed=!!preview&&!!current&&preview.revision!==current.revision;
 const cents=adjustmentAmountCents(amount),target=preview?.items.find(row=>row.id===item);
 const allowed=!!current&&!!preview&&!api.query.isFetching&&!changed&&!failed&&!pending&&reason.trim().length>=5&&reason.trim().length<=2000
  &&(action==='add'?current.can_add&&cents!==null&&description.trim().length>0&&description.trim().length<=500:current.can_remove&&!!target&&current.items.some(row=>row.id===item));
 const open=(next:'add'|'remove',id:string|null)=>{if(!current)return;setAction(next);setItem(id);setPreview(current);setNotice('');setFailed(false);};
 const refresh=async()=>{const result=await api.query.refetch();if(result.isSuccess&&result.data){setPreview(previous=>previous?result.data:undefined);setFailed(false);setNotice('');}};
 const submit=async()=>{if(!allowed||!preview)return;setNotice('');const shared={settlement_id:settlementId,reason,expected_revision:preview.revision};
  const input:SettlementAdjustmentInput=action==='add'?{...shared,action:'add',item_id:null,nature,amount_cents:cents!,description}:{...shared,action:'remove',item_id:item!,nature:null,amount_cents:null,description:null};
  try{await api.submit(input);setNotice('Ajuste confirmado pelo banco.');setPreview(undefined);setAmount('');setDescription('');setReason('');}
  catch(cause){setNotice(settlementAdjustmentError(cause));setFailed(true);}
 };
 return <section aria-label="Ajustes auditados do acerto" className="space-y-3">
  <SettlementAdjustmentRecovery api={api}/>
  {api.query.isPending?<p role="status">Consultando ajustes…</p>:null}
  {api.query.isError?<p role="alert">Falha ao consultar ajustes: {settlementAdjustmentError(api.query.error)}</p>:null}
  <Button variant="outline" disabled={api.query.isFetching||api.isPending} onClick={()=>void refresh()}>Atualizar conferência dos ajustes</Button>
  {current?<>
   <p>Total a pagar: {money(current.totals.payable_cents)} · Pago: {money(current.totals.paid_cents)} · Saldo: {money(current.totals.balance_cents)}</p>
   {current.requires_reconciliation?<p role="alert">Há valores históricos inválidos. Confira a origem antes de incluir ajustes; uma remoção também exige que o resultado possa ser recalculado.</p>:null}
   {!current.can_remove?<p>Este acerto está fechado para ajustes.</p>:null}
   <Button disabled={!current.can_add||pending||!!preview} onClick={()=>open('add',null)}>Conferir novo ajuste</Button>
   {current.items.length===0?<p>Sem ajustes manuais.</p>:<ul className="space-y-2">{current.items.map(row=><li key={row.id} className="rounded border p-2">
    <p>{row.nature==='credit'?'Crédito':row.nature==='debit'?'Débito':'Tipo inválido'} · {money(row.amount_cents)} · {row.description||'Sem descrição'}</p><p>Motivo: {row.reason||'Não informado'}</p>
    <Button variant="outline" disabled={!current.can_remove||pending||!!preview} onClick={()=>open('remove',row.id)}>Remover ajuste: {row.description||row.id}</Button>
   </li>)}</ul>}
  </>:null}
  {preview?<form aria-label={action==='add'?'Novo ajuste do acerto':'Remoção de ajuste'} onSubmit={event=>{event.preventDefault();void submit();}} className="space-y-3 rounded border p-3">
   <h3>{action==='add'?'Conferir inclusão de ajuste':'Conferir remoção de ajuste'}</h3>
   {changed||failed?<p role="alert">Atualize a conferência dos ajustes antes de confirmar novamente. Seu rascunho foi preservado.</p>:null}
   <fieldset disabled={api.isPending||!!api.pending||!!api.recoveryError} className="space-y-3">
    {action==='add'?<>
     <Label htmlFor={prefix+'nature'}>Tipo do ajuste</Label><select id={prefix+'nature'} className="w-full rounded border p-2" value={nature} onChange={event=>setNature(event.target.value as 'credit'|'debit')}><option value="credit">Crédito — aumenta o valor ao motorista</option><option value="debit">Débito — reduz o valor ao motorista</option></select>
     <Label htmlFor={prefix+'amount'}>Valor do ajuste (R$)</Label><Input id={prefix+'amount'} inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} aria-describedby={prefix+'amount-help'}/><p id={prefix+'amount-help'}>Informe um valor positivo, com até duas casas decimais.</p>
     <Label htmlFor={prefix+'description'}>Descrição do ajuste</Label><Input id={prefix+'description'} maxLength={500} value={description} onChange={event=>setDescription(event.target.value)}/>
    </>:current?<p>Remover {target?.description||item}: {money(target?.amount_cents??null)}. O histórico será preservado.</p>:null}
    <Label htmlFor={prefix+'reason'}>Motivo do ajuste</Label><Textarea id={prefix+'reason'} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/>
    {current&&!changed&&!failed&&action==='add'&&cents!==null?<p>{nature==='credit'?'Crédito':'Débito'} de {money(cents)}. O saldo será recalculado com as despesas atuais. Não efetua pagamento.</p>:null}
    <Button type="submit" disabled={!allowed}>Confirmar {action==='add'?'inclusão':'remoção'} do ajuste</Button>{' '}
    <Button type="button" variant="outline" onClick={()=>{setPreview(undefined);setNotice('');}}>Fechar conferência</Button>
   </fieldset>
  </form>:null}
  {notice?<p role="status">{notice}</p>:null}
 </section>;
}
