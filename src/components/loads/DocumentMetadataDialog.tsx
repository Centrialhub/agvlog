import {useState} from 'react';
import {useDocumentMetadataWrites} from '@/hooks/useDocumentMetadataWrites';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';
import {ADMIN_FIELD_LABELS,isMetadataPayload,type MetadataItem,type MetadataResult,type AdminFields} from '@/lib/loads/documentMetadata';
import {getErrorMessage} from '@/lib/errors';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';import {Label} from '@/components/ui/label';import {Textarea} from '@/components/ui/textarea';
export function DocumentMetadataDialog({loadId,tenantId,actorId,items,documentLabels,onClose,onConfirmed}:{loadId:string;tenantId:string;actorId:string;items:MetadataItem[];documentLabels:Record<string,string>;onClose:()=>void;onConfirmed:(result:MetadataResult)=>void}){
 const api=useDocumentMetadataWrites();const {user}=useAuth();const {currentTenant}=useTenant();const [reason,setReason]=useState('');const [error,setError]=useState('');
 const pending=api.pending.find(row=>row.payload.load_id===loadId);const scopeValid=tenantId===currentTenant?.id&&actorId===user?.id;
 const frozen=!scopeValid||api.isPending||!!pending||!!api.recoveryError;
 const payload={tenant_id:tenantId,load_id:loadId,reason:reason.trim(),items};
 const submit=async()=>{if(frozen||!isMetadataPayload(payload))return;setError('');try{onConfirmed(await api.submit(payload));onClose();}catch(failure){setError(getErrorMessage(failure,'Conferência não confirmada.'));}};
 const recover=async()=>{setError('');try{onConfirmed(await api.recover(loadId));onClose();}catch(failure){setError(getErrorMessage(failure,'Recuperação não confirmada.'));}};
 return <Dialog open onOpenChange={open=>{if(!open&&!api.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto">
  <DialogHeader><DialogTitle>Confirmar conferência de {items.length} nota(s)</DialogTitle><DialogDescription>Revise os campos alterados. Este registro administrativo não baixa uma entrega, não substitui o comprovante e não confirma pagamento. Todas as notas deste lote são salvas juntas.</DialogDescription></DialogHeader>
  {items.map(item=><div key={item.document_id} className="rounded border p-2"><p>Nota {documentLabels[item.document_id]||item.document_id.slice(0,8)}</p>
   {Object.entries(item.changes).map(([field,value])=><p key={field}>{ADMIN_FIELD_LABELS[field as keyof AdminFields]}: {typeof value==='boolean'?(value?'Recebido':'Não recebido'):value||'Não informado'}</p>)}
  </div>)}
  <div><Label htmlFor="metadata-reason">Motivo e fonte da conferência</Label><Textarea id="metadata-reason" maxLength={2000} disabled={frozen} value={reason} onChange={e=>setReason(e.target.value)}/></div>
  {!scopeValid?<p role="alert">A sessão ou empresa mudou. Feche e confira novamente as notas na sessão correta.</p>:null}
  {pending?<p role="alert">Há pedido sem confirmação. <Button disabled={api.isPending||!scopeValid} onClick={()=>void recover()}>Recuperar conferência</Button></p>:null}
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}
  <DialogFooter><Button variant="outline" disabled={api.isPending} onClick={onClose}>Fechar</Button><Button disabled={frozen||!isMetadataPayload(payload)} onClick={()=>void submit()}>Salvar conferência</Button></DialogFooter>
 </DialogContent></Dialog>;
}
