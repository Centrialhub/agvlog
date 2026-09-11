import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {cashDenominations,cashOpeningCommandSchema,totalCashCounts,type CashOpeningCommand} from '@/lib/financial/cashOpeningContract';
export function CashOpeningForm({tenant,account,from,disabled,onConfirm}:{tenant:string;account:string;from:string;disabled:boolean;onConfirm:(command:CashOpeningCommand)=>void}){
 const [date,setDate]=useState(from),[custodian,setCustodian]=useState(''),[reason,setReason]=useState(''),[quantities,setQuantities]=useState<Record<number,string>>({}),[review,setReview]=useState<CashOpeningCommand>();
 const rows=cashDenominations.map(denomination_cents=>({denomination_cents,quantity:/^\d{1,9}$/.test(quantities[denomination_cents]||'0')?Number(quantities[denomination_cents]||0):-1}));
 const parsed=cashOpeningCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:'00000000-0000-4000-8000-000000000001',account_id:account,effective_from:date,custodian_name:custodian,reason,counts:rows});
 const total=rows.every(row=>row.quantity>=0)?totalCashCounts(rows):null;
 return <section aria-label="Contagem de abertura do caixa" className="space-y-3"><h4>Contagem física de abertura</h4><p>Informe o dinheiro disponível no início do dia escolhido, antes dos movimentos desse dia. Uma contagem feita depois não confirma esse saldo inicial. Este registro não movimenta dinheiro nem fecha o caixa.</p>
 {review?<><p>Revisão: início de {review.effective_from} · responsável pela guarda: {review.custodian_name}</p><CashCountDetails counts={review.counts}/><p>Total revisado: {formatFinanceCents(totalCashCounts(review.counts))}</p><p>Motivo: {review.reason}</p><Button disabled={disabled} onClick={()=>onConfirm(review)}>Confirmar contagem de abertura</Button><Button variant="outline" disabled={disabled} onClick={()=>setReview(undefined)}>Voltar à contagem</Button></>:<>
 <label>Data do saldo no início do dia<Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Responsável pela guarda do caixa<Input maxLength={200} value={custodian} onChange={e=>setCustodian(e.target.value)}/></label>
 <fieldset disabled={disabled} className="grid grid-cols-2 gap-2"><legend>Cédulas e moedas (quantidades inteiras)</legend>{cashDenominations.map(value=><label key={value}>{formatFinanceCents(value)}<Input aria-label={`Quantidade de ${formatFinanceCents(value)}`} inputMode="numeric" value={quantities[value]||''} placeholder="0" onChange={e=>setQuantities({...quantities,[value]:e.target.value})}/></label>)}</fieldset>
 <p>Total da contagem: {total===null?'Quantidade inválida':formatFinanceCents(total)}</p><label>Motivo da contagem<Textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={disabled||!parsed.success} onClick={()=>{if(parsed.success)setReview({...parsed.data,request_id:crypto.randomUUID()});}}>Revisar contagem</Button>
 </>}
 </section>;
}
export function CashCountDetails({counts}:{counts:CashOpeningCommand['counts']}){return <ul className="list-disc pl-5">{counts.map(row=><li key={row.denomination_cents}>{formatFinanceCents(row.denomination_cents)} × {row.quantity} = {formatFinanceCents((BigInt(row.denomination_cents)*BigInt(row.quantity)).toString())}</li>)}</ul>;}
