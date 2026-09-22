import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {usePayableAction} from '@/hooks/usePayableAction';
import {archivePayablesSchema} from '@/lib/financial/payableActions';
export type ArchiveSelection={payable_id:string;revision:string;description:string|null};
export function PayableArchiveDialog({tenant,actor,titles,onClose,onRecorded}:{tenant:string;actor:string;titles:ArchiveSelection[];onClose:()=>void;onRecorded:()=>void}){
 const [reason,setReason]=useState(''),[error,setError]=useState('');
 const action=usePayableAction(tenant,actor,'archive',()=>{onRecorded();onClose();});
 function confirm(){const command=archivePayablesSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),items:titles.map(({payable_id,revision})=>({payable_id,revision})),reason});if(!command.success){setError('Selecione até 100 títulos e informe um motivo com pelo menos 10 caracteres.');return;}setError('');void action.send(command.data);}
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}><DialogContent><DialogHeader><DialogTitle>Excluir contas selecionadas da lista</DialogTitle><DialogDescription>Contas abertas elegíveis serão canceladas e retiradas da lista. Os registros e a auditoria serão preservados em “Excluídos”. Contas com pagamentos ou vínculos operacionais exigem revisão; se alguma for impedida, nenhuma será excluída.</DialogDescription></DialogHeader>
  {action.pending&&'items' in action.pending?<><p role="status">Exclusão de {action.pending.items.length} título(s) sem confirmação. Retome o pedido original.</p><p>{action.pending.reason}</p><Button disabled={action.busy||action.blocked} onClick={()=>void action.send()}>Retomar exclusão</Button></>:<><ul className="max-h-48 overflow-auto">{titles.map(t=><li key={t.payable_id}>{t.description||t.payable_id}</li>)}</ul><label>Motivo da exclusão<Input value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><Button variant="destructive" disabled={action.busy||action.blocked||!titles.length} onClick={confirm}>Confirmar exclusão da lista</Button></>}
  {(error||action.error)&&<p role="alert">{error||action.error}</p>}
 </DialogContent></Dialog>;
}
