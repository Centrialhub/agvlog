import {OpenComplementExtinctionDialog} from './OpenComplementExtinctionDialog';
import {UnloadingOpenComplementDialog} from './UnloadingOpenComplementDialog';
import {UnloadingCostRegularizationDialog} from './UnloadingCostRegularizationDialog';
import {useTenant} from '@/hooks/useTenant';
import {UnloadingCostCorrectionDialog} from './UnloadingCostCorrectionDialog';
import {ExpenseCostHistory} from './ExpenseCostHistory';
import {expenseCurrentComplement,expenseCostMoney} from '@/lib/financial/expenseCostPresentation';
import {ExpenseUnloadingHistory} from './ExpenseUnloadingHistory';
import {ExpenseArtifactPanel} from './ExpenseArtifactPanel';
import {ExpenseCancellationReview} from './ExpenseCancellationReview';
import {useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {ExpenseReceiptDialog} from './ExpenseReceiptDialog';
import {expenseCategories} from '@/lib/financial/expenseBatchContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import type {ExpenseHistoryRow} from '@/lib/financial/expenseHistoryContract';
const statusLabel=(status:string|null)=>({pending:'Pendente',paid:'Pago',received:'Recebido',partially_paid:'Parcial',partial:'Parcial',cancelled:'Cancelado',overdue:'Vencido'}[status||'']||'Consultar título');
export function ExpenseHistoryDetail({row,actor,onClose,currentUnavailable=false}:{row:ExpenseHistoryRow;actor:string;onClose:()=>void;currentUnavailable?:boolean}) {
  const [receipt,setReceipt]=useState(false),[costCorrection,setCostCorrection]=useState(false),[regularization,setRegularization]=useState(false),[openComplement,setOpenComplement]=useState(false),[extinction,setExtinction]=useState(false);
  const {currentRole}=useTenant();
  const canReadComplement=!!row.unloading_id&&['owner','admin','operator'].includes(currentRole||'');
  const canCorrectCost=!!row.unloading_id&&['owner','admin'].includes(currentRole||'');
  return <><Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{row.description}</DialogTitle><DialogDescription>{row.batch_description}</DialogDescription></DialogHeader>
    <ExpenseCancellationReview tenant={row.tenant_id} actor={actor} expenseId={row.id}/><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt>Categoria</dt><dd className="font-medium">{expenseCategories[row.category as keyof typeof expenseCategories]||row.category}</dd></div>
      <div><dt>Valor original do gasto</dt><dd className="font-medium">{formatFinanceCents(row.amount_cents)}</dd></div>
      <div><dt>Estabelecimento / prestador</dt><dd>{row.supplier_name}</dd></div><div><dt>Data</dt><dd>{row.occurred_on.split('-').reverse().join('/')}</dd></div>
      <div><dt>Centro de custo</dt><dd>{row.cost_center_name||'Não informado'}</dd></div><div><dt>Documento</dt><dd>{row.document_number||'Não informado'}</dd></div></dl>
    {currentUnavailable?<p role="status">Atualizando o detalhe. Os valores vigentes estão indisponíveis nesta consulta; a conferência aberta conserva seu próprio pedido.</p>:<ExpenseCostHistory row={row}/>}
    {canCorrectCost&&<Button variant="outline" disabled={currentUnavailable} onClick={()=>setCostCorrection(true)}>Conferir correção do custo da descarga</Button>}
    {canCorrectCost&&<Button variant="outline" disabled={currentUnavailable} onClick={()=>setRegularization(true)}>Conferir regularização de custo coberto</Button>}
    {canReadComplement&&<Button variant="outline" disabled={currentUnavailable} onClick={()=>setExtinction(true)}>Conferir redução até o valor já enviado</Button>}
    {canReadComplement&&<Button variant="outline" disabled={currentUnavailable} onClick={()=>setOpenComplement(true)}>Conferir correção do complemento aberto</Button>}
    {row.receipt_path?<Button variant="outline" onClick={()=>setReceipt(true)}>Ver comprovante</Button>:<p className="rounded border p-3 text-sm">{(row.receipt_artifact_count??0)>0?'Comprovante adicional anexado. ':''}Sem comprovante no registro original: {row.no_receipt_reason||'Justificativa não informada'}</p>}
    <ExpenseArtifactPanel tenant={row.tenant_id} actor={actor} expense={row.id}/>
    <div className="space-y-2"><h3 className="font-medium">Envios vinculados</h3>
      {row.allocations.map(a=><div key={a.movement_id} className="rounded border p-3 text-sm"><p>{a.beneficiary_name} · {a.occurred_on.split('-').reverse().join('/')}</p>
        <p>Envio de {formatFinanceCents(a.movement_amount_cents)} · Vínculo original deste gasto: {formatFinanceCents(a.amount_cents)}</p><p>Referência: {a.bank_reference||'Não informada'}</p></div>)}
      {!row.allocations.length&&<p className="text-sm">Nenhum envio vinculado ao registrar este gasto.</p>}
      <p className="text-xs text-muted-foreground">O vínculo explica a utilização do envio. A confirmação bancária depende da conciliação com o extrato.</p>
    </div>
    {!currentUnavailable&&row.payable_id&&<div className="rounded border p-3 text-sm"><h3 className="font-medium">Obrigação vinculada em contas a pagar</h3>
      <p>{expenseCostMoney(expenseCurrentComplement(row))} · {statusLabel(row.payable_status)}</p></div>}
    {!currentUnavailable&&<ExpenseUnloadingHistory row={row}/>}
    <div className="space-y-2"><h3 className="font-medium">Histórico</h3>{row.history.map(event=><div key={event.id} className="border-l-2 pl-3 text-sm">
      <p className="font-medium">{event.actor_name} · {event.action==='recorded'?'Registrou o lote':event.action==='expense_cancelled'?'Cancelou o gasto':event.action}</p>
      <p className="text-xs text-muted-foreground">Responsável: {event.actor_id}</p>
      <p>{new Date(event.created_at).toLocaleString('pt-BR')} · {event.reason}</p></div>)}
      {!row.history.length&&<p className="text-sm">Histórico indisponível. Recarregue a consulta.</p>}</div>
  </DialogContent></Dialog>{canCorrectCost&&costCorrection&&row.unloading_id&&<UnloadingCostCorrectionDialog key={`${row.tenant_id}:${actor}:${row.unloading_id}`} tenant={row.tenant_id} actor={actor} chargeId={row.unloading_id} open onOpenChange={setCostCorrection}/>}
  {canCorrectCost&&regularization&&row.unloading_id&&<UnloadingCostRegularizationDialog key={`${row.tenant_id}:${actor}:${row.unloading_id}`} tenant={row.tenant_id} actor={actor} chargeId={row.unloading_id} open onOpenChange={setRegularization}/>}
  {canReadComplement&&openComplement&&row.unloading_id&&<UnloadingOpenComplementDialog key={`${row.tenant_id}:${actor}:${row.unloading_id}`} tenant={row.tenant_id} actor={actor} chargeId={row.unloading_id} open onOpenChange={setOpenComplement}/>}
  {canReadComplement&&extinction&&row.unloading_id&&<OpenComplementExtinctionDialog key={`${row.tenant_id}:${actor}:${row.unloading_id}`} tenant={row.tenant_id} actor={actor} chargeId={row.unloading_id} open onOpenChange={setExtinction}/>}
  {receipt&&row.receipt_path&&<ExpenseReceiptDialog tenantId={row.tenant_id} path={row.receipt_path} onClose={()=>setReceipt(false)}/>}</>;
}
