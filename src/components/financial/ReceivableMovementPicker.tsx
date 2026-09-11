import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {readReceiptMovementOptions} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
export function ReceivableMovementPicker({tenant,account,date,value,onSelect}:{tenant:string;account:string;date:string;value:string;onSelect:(id:string)=>void}){
 const {user}=useAuth();const [draft,setDraft]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 const query=useQuery({queryKey:['finance-receipt-movement-options',tenant,user?.id,account,date,search,page],enabled:!!account&&!!date&&!!user,retry:false,
  queryFn:()=>readReceiptMovementOptions(tenant,account,date,search,page)}),data=query.error?undefined:query.data;
 if(!account||!date)return <p>Selecione a conta e a data para consultar as entradas registradas.</p>;
 return <section aria-label="Escolher entrada registrada" className="space-y-2 rounded border p-3"><p>Escolha a entrada que pagou este título. A baixa usará seu saldo disponível e não criará outra entrada.</p>
  <div className="flex gap-2"><label className="flex-1">Buscar entrada<Input value={draft} maxLength={200} onChange={e=>setDraft(e.target.value)}/></label><Button type="button" variant="outline" onClick={()=>{setSearch(draft);setPage(1);}}>Buscar</Button></div>
  {query.isPending&&<p role="status">Consultando entradas…</p>}{query.error&&<p role="alert">Não foi possível consultar as entradas. <Button type="button" onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
  {data&&<><p>{data.total} entrada(s) com saldo disponível nesta conta e data.</p>{data.rows.map(row=><label key={row.id} className="block rounded border p-2 text-sm"><input type="radio" name="receipt-movement" checked={value===row.id} onChange={()=>onSelect(row.id)}/> {row.counterparty} · {row.description} · Disponível: {formatFinanceCents(row.available_cents)} de {formatFinanceCents(row.amount_cents)}{row.bank_reference?` · Referência: ${row.bank_reference}`:''}</label>)}
   <div className="flex justify-between"><Button type="button" variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Entradas anteriores</Button><span>Página {page}</span><Button type="button" variant="outline" disabled={page*20>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próximas entradas</Button></div>
  </>}
 </section>;
}
