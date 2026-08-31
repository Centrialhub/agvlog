import {useEffect,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';
import {useRedelivery,useRedeliveryContext} from '@/hooks/useRedelivery';
import {isRedeliveryPayload,redeliveryMessage,type RedeliveryContext,type RedeliveryResult} from '@/lib/loads/redelivery';
import {getErrorMessage} from '@/lib/errors';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';import {Input} from '@/components/ui/input';import {Label} from '@/components/ui/label';import {Textarea} from '@/components/ui/textarea';
type Draft={source_item_id:string;item_description:string;pallet_count:string;weight_kg:string;volume_m3:string};
export function RedeliveryDialog({documentId,loadId,invoiceNumber,onClose,onConfirmed}:{documentId:string;loadId:string;invoiceNumber:string;onClose:()=>void;onConfirmed:(result:RedeliveryResult)=>void}){
 const context=useRedeliveryContext(documentId);const api=useRedelivery();const {user}=useAuth();const {currentTenant}=useTenant();
 const [selected,setSelected]=useState<RedeliveryContext|null>(null);const [items,setItems]=useState<Draft[]>([]);const [reason,setReason]=useState('');const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setSelected(null);setItems([]);setReason('');setError(null);},[documentId,loadId,user?.id,currentTenant?.id]);
 const pending=api.pending.find(row=>row.payload.document_id===documentId);const changed=!!selected&&selected.revision!==context.data?.revision;
 const frozen=api.isPending||!!pending||!!api.recoveryError;
 const review=()=>{const c=context.data;if(!c?.can_request||!c.remainder||c.load_id!==loadId)return;
  setSelected(c);setError(null);setItems(c.remainder.items.map(item=>({source_item_id:item.id,item_description:item.item_description||'',
   pallet_count:item.remaining_quantity===item.quantity?String(item.pallet_count):'',
   weight_kg:item.remaining_quantity===item.quantity&&item.weight_kg!==null?String(item.weight_kg):'',
   volume_m3:item.remaining_quantity===item.quantity&&item.volume_m3!==null?String(item.volume_m3):''})));
 };
 const payload={tenant_id:currentTenant?.id||'',document_id:documentId,revision:selected?.revision||'',reason:reason.trim(),
  items:items.map(item=>({...item,pallet_count:Number(item.pallet_count),weight_kg:Number(item.weight_kg),volume_m3:Number(item.volume_m3)}))};
 const valid=!!selected&&selected.tenant_id===currentTenant?.id&&selected.actor_id===user?.id&&selected.document_id===documentId
  &&selected.load_id===loadId&&isRedeliveryPayload(payload)&&items.every(item=>item.pallet_count!==''&&item.weight_kg!==''&&item.volume_m3!=='');
 const submit=async()=>{if(frozen||changed||!valid||!selected?.load_id||!selected.trip_id||!selected.stop_id||!selected.outcome_id)return;
  setError(null);try{const result=await api.submit(payload,{loadId:selected.load_id,tripId:selected.trip_id,stopId:selected.stop_id,outcomeId:selected.outcome_id});onConfirmed(result);onClose();}
  catch(failure){setError(getErrorMessage(failure,'Não foi possível confirmar a reentrega.'));}
 };
 const recover=async()=>{setError(null);try{const result=await api.recover(documentId);onConfirmed(result);onClose();}catch(failure){setError(getErrorMessage(failure,'Recuperação não confirmada.'));}};
 return <Dialog open onOpenChange={open=>{if(!open&&!api.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto">
  <DialogHeader><DialogTitle>Reentrega da nota {invoiceNumber}</DialogTitle><DialogDescription>Libera somente o saldo não entregue para uma nova carga. A tentativa anterior e seus comprovantes permanecem no histórico. Não emite documentos nem efetua pagamentos.</DialogDescription></DialogHeader>
  {context.isPending?<p role="status">Carregando saldo auditado…</p>:null}
  {context.error?<p role="alert">{getErrorMessage(context.error,'Falha ao carregar saldo.')} <Button variant="outline" onClick={()=>void context.refetch()}>Tentar novamente</Button></p>:null}
  {context.data&&!context.data.can_request?<p role="status">{redeliveryMessage(new Error(context.data.blocking_reason||'requires_undelivered_balance'))}</p>:null}
  {context.data?.can_request&&context.data.load_id!==loadId?<p role="alert">A nota não pertence mais a esta carga. Consulte sua alocação atual.</p>:null}
  <Button variant="outline" disabled={frozen||context.isFetching||!context.data?.can_request||context.data.load_id!==loadId} onClick={review}>Revisar saldo atual</Button>
  {selected?.financial_review?<p className="text-sm">O acerto anterior ({selected.financial_review.status}) será preservado. O frete não será reaproveitado automaticamente na nova viagem.</p>:null}
  {items.map((item,index)=><fieldset key={item.source_item_id} disabled={frozen} className="space-y-2 rounded border p-3"><legend>Item {index+1} — saldo {selected?.remainder?.items[index].remaining_quantity} de {selected?.remainder?.items[index].quantity}</legend>
   <Label htmlFor={'redelivery-description-'+index}>Descrição do saldo — item {index+1}</Label><Input id={'redelivery-description-'+index} maxLength={2000} value={item.item_description} onChange={e=>setItems(rows=>rows.map((row,n)=>n===index?{...row,item_description:e.target.value}:row))}/>
   {(['pallet_count','weight_kg','volume_m3'] as const).map(field=><div key={field}><Label htmlFor={`redelivery-${field}-${index}`}>{({pallet_count:'Pallets',weight_kg:'Peso (kg)',volume_m3:'Cubagem (m³)'})[field]} — item {index+1}</Label>
    <Input id={`redelivery-${field}-${index}`} type="number" min="0" step={field==='pallet_count'?'1':'any'} value={item[field]} onChange={e=>setItems(rows=>rows.map((row,n)=>n===index?{...row,[field]:e.target.value}:row))}/></div>)}
  </fieldset>)}
  <div><Label htmlFor="redelivery-reason">Motivo e conferência da reentrega</Label><Textarea id="redelivery-reason" maxLength={2000} disabled={frozen} value={reason} onChange={e=>setReason(e.target.value)}/></div>
  {changed?<p role="alert">O saldo mudou. Revise o saldo atual antes de confirmar; a justificativa foi preservada.</p>:null}
  {pending?<p role="alert">Há pedido sem confirmação. Não envie outra reentrega. <Button disabled={api.isPending} onClick={()=>void recover()}>Recuperar reentrega</Button></p>:null}
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}
  <DialogFooter><Button variant="outline" disabled={api.isPending} onClick={onClose}>Fechar</Button><Button disabled={frozen||changed||!valid||context.isFetching} onClick={()=>void submit()}>Confirmar reentrega</Button></DialogFooter>
 </DialogContent></Dialog>;
}
