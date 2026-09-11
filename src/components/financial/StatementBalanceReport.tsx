import {z} from 'zod';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
const schema=z.object({status:z.enum(['not_configured','insufficient_evidence','inconsistent','consistent']),checked_transitions:z.number().int().nonnegative(),covered_transactions:z.number().int().nonnegative(),
  balance_samples:z.number().int().nonnegative(),discrepancy_count:z.number().int().nonnegative(),order_consistent:z.boolean().nullable(),
  discrepancies:z.array(z.object({source_row:z.number().int().positive(),expected_cents:z.string().regex(/^-?\d+$/),actual_cents:z.string().regex(/^-?\d+$/)}))});
const labels={not_configured:'Significado ou ordem dos saldos não confirmados',insufficient_evidence:'Saldos insuficientes para conferir a sequência',inconsistent:'Divergência na sequência dos saldos',consistent:'Sequência de saldos aritmeticamente compatível'};
export function StatementBalanceReport({report}:{report:unknown}){
  const parsed=schema.safeParse(report);if(!parsed.success)return <p className="text-sm">Conferência da sequência de saldos ainda indisponível.</p>;const data=parsed.data;
  return <div className={`space-y-2 rounded border p-3 ${data.status==='inconsistent'?'border-destructive':''}`}>
    <p className="font-medium">{labels[data.status]}</p><p className="text-sm">{data.balance_samples} saldos informados · {data.checked_transitions} intervalos conferidos · {data.covered_transactions} transações entre os saldos.</p>
    {data.order_consistent===false&&<p role="alert">As datas não seguem a ordem informada. Revise a interpretação do arquivo.</p>}
    {data.discrepancy_count>0&&<><p role="alert">{data.discrepancy_count} divergência(s). Mostrando até 100.</p>{data.discrepancies.map(item=><p key={item.source_row} className="text-sm">Registro {item.source_row}: esperado {formatFinanceCents(item.expected_cents)}, informado {formatFinanceCents(item.actual_cents)}.</p>)}</>}
    <p className="text-xs text-muted-foreground">A sequência confere somente os intervalos entre saldos informados. Conta, cobertura completa do período, saldo inicial/final e conciliação continuam pendentes.</p>
  </div>;
}
