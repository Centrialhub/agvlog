import {z} from 'zod';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {cashPeriodCountSchema} from '@/lib/financial/cashPeriodContract';
import {formatFinanceCents,movementNatures} from '@/lib/financial/ledgerContract';
const cents=z.string().regex(/^-?\d+$/);
const snapshotSchema=z.object({evidence_type:z.literal('cash_count_v1'),count:cashPeriodCountSchema,balances:z.object({opening_cents:cents,in_cents:cents,out_cents:cents,expected_closing_cents:cents,counted_closing_cents:cents,difference_cents:cents})});
const movementsSchema=z.object({movements:z.array(z.object({id:z.string().uuid(),occurred_on:z.string(),description:z.string(),direction:z.enum(['in','out']),nature:z.string(),amount_cents:z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe()]).transform(String)}))});
/** Displays the saved decision only; reopening never replaces these amounts. */
export function CashPeriodEvidenceSummary({snapshot}:{snapshot:Record<string,unknown>}){
 const [page,setPage]=useState(1);
 const parsed=snapshotSchema.safeParse(snapshot);
 if(!parsed.success)return <p role="alert">A contagem preservada está incompleta. Consulte o registro integral antes de confiar no resumo.</p>;
 const {count,balances}=parsed.data,value=formatFinanceCents;
 const movements=movementsSchema.safeParse(snapshot.facts);
 return <section aria-label="Contagem preservada no fechamento" className="space-y-2">
  <h5 className="font-medium">Caixa físico · contagem de encerramento</h5>
  <p>Saldo inicial {value(balances.opening_cents)} · entradas {value(balances.in_cents)} · saídas {value(balances.out_cents)}</p>
  <p>Saldo esperado {value(balances.expected_closing_cents)} · contado {value(balances.counted_closing_cents)} · diferença {value(balances.difference_cents)}</p>
  <p>Contagem {count.id} · encerramento do dia {count.period_end} · responsável pelo caixa: {count.custodian_name}</p>
  <p>Registrada por {count.actor_name} ({count.actor_id}) em {count.created_at}. Motivo: {count.reason}</p>
  <table className="w-full text-left"><thead><tr><th>Denominação</th><th>Quantidade</th></tr></thead><tbody>{count.counts.map(row=><tr key={row.denomination_cents}><td>{value(String(row.denomination_cents))}</td><td>{row.quantity}</td></tr>)}</tbody></table>
  <p>Esta evidência registra uma contagem física declarada. Não corresponde a um extrato bancário.</p>
  <section aria-label="Movimentos preservados do caixa" className="space-y-2"><h5 className="font-medium">Movimentos preservados do caixa</h5>
   {movements.success?<><p>{movements.data.movements.length} movimentos no registro preservado.</p>{movements.data.movements.slice((page-1)*30,page*30).map(movement=><article key={movement.id} className="border rounded p-2"><p>{movement.description} · {movement.occurred_on} · {movement.direction==='in'?'Entrada':'Saída'} · {value(movement.amount_cents)}</p><p>{movementNatures[movement.nature as keyof typeof movementNatures]||movement.nature} · movimento {movement.id}</p></article>)}<div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Movimentos do caixa anteriores</Button><span>Página {page}</span><Button variant="outline" disabled={page*30>=movements.data.movements.length} onClick={()=>setPage(page+1)}>Próximos movimentos do caixa</Button></div></>:<p role="alert">Os movimentos preservados desta versão não estão disponíveis no resumo. Consulte a exportação integral.</p>}
  </section>
 </section>;
}
