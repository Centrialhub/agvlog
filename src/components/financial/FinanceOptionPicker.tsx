import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readExpenseOptions } from '@/lib/financial/ledgerClient';
import { formatFinanceCents } from '@/lib/financial/ledgerContract';
import type { ExpenseOptionKind, FinanceOption } from '@/lib/financial/expenseBatchContract';

export function FinanceOptionPicker({ tenant, actor, kind, trip = null, label, value, onChange }: {
  tenant: string; actor: string; kind: ExpenseOptionKind; trip?: string | null; label: string;
  value: FinanceOption | null; onChange: (value: FinanceOption | null) => void;
}) {
  const [open,setOpen] = useState(false), [search,setSearch] = useState(''), [term,setTerm] = useState(''), [page,setPage] = useState(1);
  const trigger=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(open)searchInput.current?.focus();},[open]);
  const query = useQuery({ queryKey: ['finance-options',tenant,actor,kind,trip,term,page], enabled: open,
    queryFn: () => readExpenseOptions(tenant,kind,term,trip,page), staleTime: 0 });
  return <div className="space-y-2">
    <div className="flex items-center gap-2"><Button ref={trigger} type="button" variant="outline" className="h-auto min-h-10 whitespace-normal text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
      {label}: {value?.label || 'Selecionar'}</Button>{value && <Button type="button" variant="ghost" aria-label={`Limpar ${label}`} onClick={() => onChange(null)}>Limpar</Button>}</div>
    {open && <div className="space-y-2 rounded border p-3" role="group" aria-label={`Selecionar ${label}`} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
      <div className="flex gap-2"><Input ref={searchInput} aria-label={`Buscar ${label}`} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter') {e.preventDefault();setTerm(search);setPage(1);}
      }} /><Button type="button" onClick={() => {setTerm(search);setPage(1);}}>Buscar</Button></div>
      {(query.isPending||query.isFetching) && <p role="status">Conferindo opções disponíveis…</p>}
      {query.error && <p role="alert">Não foi possível carregar. <Button type="button" onClick={() => void query.refetch()}>Tentar novamente</Button></p>}
      {query.data && !query.error && !query.isFetching && <><div className="max-h-48 overflow-y-auto">{query.data.rows.map(option => <Button type="button" key={option.id}
        variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" disabled={!!option.delivery?.issue}
        onClick={() => {onChange(option);setOpen(false);trigger.current?.focus();}}>
        <span>{option.label}{option.remaining_cents !== undefined && ` · Disponível ${formatFinanceCents(option.remaining_cents)}`}
          {option.delivery && <small className="block">{option.delivery.issue ? 'Composição pendente de revisão' : `Reembolso: ${option.delivery.supplier_name}`}</small>}</span>
      </Button>)}{!query.data.rows.length && <p>Nenhum resultado.</p>}</div>
      <div className="flex items-center justify-between"><Button type="button" variant="ghost" disabled={page===1} onClick={() => setPage(page-1)}>Anterior</Button>
        <span>{page} / {Math.max(1,Math.ceil(query.data.total/30))}</span><Button type="button" variant="ghost" disabled={page*30>=query.data.total} onClick={() => setPage(page+1)}>Próxima</Button></div></>}
    </div>}
  </div>;
}
