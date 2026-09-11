import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadSecureFile } from '@/lib/secureUpload';
import { expenseCategories, type ExpenseLineDraft } from '@/lib/financial/expenseBatchContract';
import { formatFinanceCents, parseFinanceAmount } from '@/lib/financial/ledgerContract';
import { FinanceOptionPicker } from './FinanceOptionPicker';

export function ExpenseBatchLine({ tenant, actor, trip, line, index, onChange, onRemove, onUploadBusy, onRepeat, onAddAfter, detailsExpanded = true, revealDetails = false }: {
  tenant: string; actor: string; trip: string | null; line: ExpenseLineDraft; index: number;
  onChange: (value: ExpenseLineDraft) => void; onRemove: () => void; onUploadBusy: (busy: boolean) => void;
  onRepeat?: () => void; onAddAfter?: () => void; detailsExpanded?: boolean; revealDetails?: boolean;
}) {
  const [expanded,setExpanded]=useState(detailsExpanded);useEffect(()=>setExpanded(detailsExpanded),[detailsExpanded]);
  useEffect(()=>{if(revealDetails)setExpanded(true);},[revealDetails]);
  const [error,setError] = useState(''), [uploading,setUploading] = useState(false);
  const field = (name: 'description'|'amount'|'date'|'supplierName'|'document'|'noReceiptReason'|'dueDate',label: string,type='text') =>
    <label className="space-y-1 text-sm"><span>{label}</span><Input aria-label={`${label} ${index+1}`} value={line[name]} type={type}
      inputMode={name==='amount'?'decimal':undefined} onChange={e => onChange({...line,[name]:e.target.value})}/></label>;
  const allocated = line.allocations.reduce((sum,a) => sum+BigInt(parseFinanceAmount(a.amount) || 0),0n);
  const remaining = BigInt(parseFinanceAmount(line.amount) || 0)-allocated;
  async function upload(file: File) {
    setUploading(true);onUploadBusy(true);setError('');
    try {
      const path = await uploadSecureFile({tenantId:tenant,bucket:'receipts',folder:'finance-batches',kind:'proof',file});
      if (!path.startsWith(`${tenant}/finance-batches/`)) throw new Error('Comprovante fora do contexto esperado.');
      onChange({...line,receiptPath:path,receiptName:file.name});
    } catch (cause) {setError(cause instanceof Error?cause.message:'Falha no envio do comprovante.');}
    finally {setUploading(false);onUploadBusy(false);}
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label={`Gasto ${index+1}`} data-expense-id={line.id} onKeyDown={event=>{if(!event.defaultPrevented&&event.ctrlKey&&!event.altKey&&!event.shiftKey&&event.key==='Enter'&&onAddAfter){event.preventDefault();onAddAfter();}}}>
    <div className="flex items-center justify-between"><strong>Gasto {index+1}</strong><div className="flex gap-2">{onRepeat&&<Button type="button" variant="outline" disabled={uploading} onClick={onRepeat}>Reutilizar dados do gasto {index+1}</Button>}<Button type="button" variant="ghost" disabled={uploading} onClick={onRemove}>Remover gasto {index+1}</Button></div></div>
    <fieldset disabled={uploading} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4"><label className="text-sm">Categoria<select aria-label={`Categoria ${index+1}`} className="h-10 w-full rounded border bg-background" value={line.category}
        onChange={e => onChange({...line,category:e.target.value as ExpenseLineDraft['category'],delivery:null})}>
        {Object.entries(expenseCategories).map(([id,label]) => <option key={id} value={id} disabled={id==='unloading'&&!trip}>{label}</option>)}</select></label>
        {field('description','Descrição')}{field('amount','Valor')}{field('date','Data','date')}
      </div>
      {line.category==='unloading' && <FinanceOptionPicker tenant={tenant} actor={actor} kind="deliveries" trip={trip} label={`Entrega ${index+1}`} value={line.delivery} onChange={delivery=>onChange({...line,delivery})}/>}
      {line.delivery?.delivery && <p className="text-sm">Conta a receber de descarga: <strong>{line.delivery.delivery.supplier_name}</strong></p>}
      <details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-sm">Fornecedor, comprovante e detalhes · {line.receiptPath?`Comprovante: ${line.receiptName}`:line.noReceiptReason.trim().length>=5?'Sem comprovante: ausência justificada':'Comprovante ou justificativa pendente'}</summary><div className="mt-3 space-y-3">
        <FinanceOptionPicker tenant={tenant} actor={actor} kind="suppliers" label={`Fornecedor ${index+1}`} value={line.supplier} onChange={supplier=>onChange({...line,supplier})}/>
        {!line.supplier && field('supplierName','Estabelecimento / prestador')}
        <FinanceOptionPicker tenant={tenant} actor={actor} kind="centers" label={`Centro de custo ${index+1}`} value={line.center} onChange={center=>onChange({...line,center})}/>
        {field('document','Número do documento')}
        <label className="block text-sm">Comprovante<Input aria-label={`Comprovante ${index+1}`} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/></label>
        {line.receiptPath ? <p className="text-sm">Anexado: {line.receiptName}</p> : field('noReceiptReason','Motivo sem comprovante')}
      </div></details>
      {error && <p role="alert">{error}</p>}{uploading && <p role="status">Enviando comprovante…</p>}
      <div className="space-y-2"><p className="text-sm font-medium">Vincular aos envios já realizados</p>
        {line.allocations.map((allocation,aIndex)=><div key={allocation.movement.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1">{allocation.movement.label}</span><Input className="w-32" aria-label={`Valor vinculado ${index+1}.${aIndex+1}`} value={allocation.amount} inputMode="decimal"
            onChange={e=>onChange({...line,allocations:line.allocations.map((a,j)=>j===aIndex?{...a,amount:e.target.value}:a)})}/>
          <Button type="button" variant="ghost" onClick={()=>onChange({...line,allocations:line.allocations.filter((_,j)=>j!==aIndex)})}>Desvincular</Button>
        </div>)}
        <FinanceOptionPicker tenant={tenant} actor={actor} kind="movements" trip={trip} label={`Envio ${index+1}`} value={null} onChange={movement=>{
          if(movement&&!line.allocations.some(a=>a.movement.id===movement.id))onChange({...line,allocations:[...line.allocations,{movement,amount:''}]});
        }}/>
      </div>
      {remaining>0n && <div className="grid items-end gap-3 sm:grid-cols-3"><p className="text-sm">Complemento a pagar: <strong>{formatFinanceCents(remaining.toString())}</strong></p>
        <label className="text-sm">Quem deve receber<select aria-label={`Favorecido ${index+1}`} className="h-10 w-full rounded border bg-background" value={line.payeeType} onChange={e=>onChange({...line,payeeType:e.target.value as ExpenseLineDraft['payeeType']})}>
          {trip&&<option value="driver">Motorista (reembolso)</option>}<option value="supplier">Fornecedor / prestador</option></select></label>{field('dueDate','Vencimento','date')}</div>}
      {remaining<0n&&<p role="alert">O vínculo excede o gasto em {formatFinanceCents((-remaining).toString())}.</p>}
    </fieldset>
  </section>;
}
