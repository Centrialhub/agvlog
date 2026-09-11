import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {readManualExpenseMovements} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import type {PayableMovementOption} from '@/lib/financial/payableMovementContract';
export function ManualExpenseMovementPicker({tenant,actor,value,onSelect}:{tenant:string;actor:string;value:PayableMovementOption|null;onSelect:(value:PayableMovementOption)=>void}){
 const [draft,setDraft]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 const query=useQuery({queryKey:['finance-manual-expense-options',tenant,actor,search,page],queryFn:()=>readManualExpenseMovements(tenant,search,page),retry:false}),data=query.error?undefined:query.data;
 return <section className="space-y-2 rounded border p-3" aria-label="Saída já registrada"><p>Selecione o envio que pagou a despesa. A conta e a data serão as desse registro.</p>
  <label>Buscar saída<Input value={draft} maxLength={200} onChange={e=>setDraft(e.target.value)}/></label><Button type="button" variant="outline" onClick={()=>{setSearch(draft);setPage(1);}}>Buscar saídas</Button>
  {query.isPending&&<p role="status">Consultando saídas…</p>}{query.error&&<p role="alert">Não foi possível consultar as saídas.</p>}
  {data&&<><p>{data.total} saída(s) com valor disponível</p>{data.rows.map(row=><label key={row.id} className="block rounded border p-2"><input type="radio" name="manual-expense-movement" checked={value?.id===row.id} onChange={()=>onSelect(row)}/> {row.beneficiary_name} · {row.account_name} · {row.occurred_on.split('-').reverse().join('/')} · Disponível {formatFinanceCents(row.remaining_cents)} · {row.description}</label>)}
   <div className="flex justify-between"><Button type="button" variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Saídas anteriores</Button><Button type="button" variant="outline" disabled={page*20>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próximas saídas</Button></div>
  </>}
 </section>;
}
