import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {readReconciliationOptions} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import type {ReconciliationKind,ReconciliationOption} from '@/lib/financial/reconciliationContract';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export function ReconciliationSelection({tenant,actor,statement,kind,selected,onChange,disabled}:{tenant:string;actor:string;statement:string;kind:ReconciliationKind;selected:ReconciliationOption[];onChange:(rows:ReconciliationOption[])=>void;disabled:boolean}){
 const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[page,setPage]=useState(1);
 const label=kind==='movements'?'Lançamentos registrados':'Linhas do extrato';
 const query=useQuery({queryKey:['finance-reconciliation-options',tenant,actor,statement,kind,term,page],retry:false,
  queryFn:()=>readReconciliationOptions(tenant,statement,kind,term,page)});
 function toggle(row:ReconciliationOption){if(selected.some(item=>item.id===row.id))onChange(selected.filter(item=>item.id!==row.id));else if(selected.length<100)onChange([...selected,row]);}
 return <section aria-label={label} className="space-y-2 rounded border p-3"><h3 className="font-semibold">{label}</h3>
  <div className="flex gap-2"><Input aria-label={`Buscar em ${label.toLowerCase()}`} maxLength={200} value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)}/>
   <Button variant="outline" disabled={disabled} onClick={()=>{setTerm(search);setPage(1);}}>Buscar</Button></div>
  <p className="text-sm">{selected.length} selecionado(s) · Total {formatFinanceCents(selected.reduce((sum,row)=>sum+BigInt(row.amount_cents),0n).toString())}</p>
  {selected.length>0&&<div className="flex flex-wrap gap-1">{selected.map(row=><Button key={row.id} variant="secondary" size="sm" disabled={disabled} onClick={()=>toggle(row)} aria-label={`Remover ${row.description}`}>{row.description} ×</Button>)}</div>}
  {query.isPending&&<p role="status">Consultando…</p>}{query.error&&<p role="alert">Consulta indisponível. <Button variant="ghost" disabled={disabled} onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
  {query.data&&!query.error&&<><div className="max-h-64 space-y-2 overflow-y-auto">{query.data.rows.map(row=><label key={row.id} className="flex items-start gap-2 rounded border p-2 text-sm">
   <input type="checkbox" checked={selected.some(item=>item.id===row.id)} disabled={disabled||!row.source_verified||(!selected.some(item=>item.id===row.id)&&selected.length>=100)} onChange={()=>toggle(row)}/>
   <span>{row.day} · {row.direction==='in'?'Entrada':'Saída'} · {formatFinanceCents(row.amount_cents)}<br/>{row.counterparty||'Contraparte não informada'} · {row.description}
    {row.reference&&<span className="block">Referência: {row.reference}</span>}{!row.source_verified&&<span className="block">Original ainda não conferido</span>}</span>
  </label>)}{!query.data.rows.length&&<p>Nenhum registro disponível neste filtro.</p>}</div>
   <div className="flex items-center justify-between"><Button variant="ghost" disabled={disabled||page===1||query.isFetching} onClick={()=>setPage(page-1)}>Anterior</Button><span className="text-sm">Página {page} · {query.data.total} registros</span>
    <Button variant="ghost" disabled={disabled||page*20>=query.data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próxima</Button></div></>}
 </section>;
}
