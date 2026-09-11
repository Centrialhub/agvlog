import {CashPeriodClosePanel} from './CashPeriodClosePanel';
import {AccountPeriodClosePanel} from './AccountPeriodClosePanel';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {readAccountDirectory} from '@/lib/financial/accountDirectoryClient';
import {AccountOpeningReview} from './AccountOpeningReview';
import {LegacyAdoptionInventory} from './LegacyAdoptionInventory';
import {LegacyUnresolvedInventory} from './LegacyUnresolvedInventory';

export function AccountOpeningEntry({tenant,actor}:{tenant:string;actor:string}){
 const [open,setOpen]=useState(false);
 return <section aria-label="Saldos e abertura por conta" className="space-y-3 rounded border p-3">
  <Button variant="outline" onClick={()=>setOpen(value=>!value)}>{open?'Ocultar consulta de contas':'Saldos e abertura por conta'}</Button>
  {open&&<Directory key={`${tenant}:${actor}`} tenant={tenant} actor={actor}/>}
 </section>;
}
function Directory({tenant,actor}:{tenant:string;actor:string}){
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 const [draft,setDraft]=useState(''),[filter,setFilter]=useState({search:'',page:1});
 const [dates,setDates]=useState({from:`${today.slice(0,7)}-01`,to:today});
 const [selected,setSelected]=useState<{id:string;name:string;type:string}|null>(null),[period,setPeriod]=useState(dates);
 const query=useQuery({queryKey:['finance-account-directory',tenant,actor,filter],queryFn:()=>readAccountDirectory(tenant,filter.search,filter.page),retry:false});
 const data=query.error||query.isFetching?undefined:query.data;
 return <div className="space-y-3">
  <p>Consulte a abertura e os saldos registrados de contas bancárias e caixas físicos, mesmo sem extrato importado. A consulta não fecha o período.</p>
  <LegacyUnresolvedInventory tenant={tenant} actor={actor}/>
  <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();setFilter({search:draft,page:1});if(filter.search===draft&&filter.page===1)void query.refetch();}}>
   <label>Buscar conta pelo nome<Input value={draft} onChange={event=>setDraft(event.target.value)}/></label><Button disabled={query.isFetching}>Buscar contas</Button>
  </form>
  {query.isFetching&&<p role="status">Consultando contas…</p>}
  {query.error&&<p role="alert">Não foi possível consultar as contas. <Button variant="link" onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
  {data&&<><ul className="space-y-1">{data.rows.map(account=><li key={account.id}><Button variant={selected?.id===account.id?'secondary':'outline'} onClick={()=>{setSelected({id:account.id,name:account.name,type:account.account_type});setPeriod({...dates});}}>{account.name} · {account.account_type==='cash'?'Caixa físico':'Conta bancária'}{!account.active?' · Inativa':''}</Button></li>)}</ul>
   {!data.rows.length&&<p>Nenhuma conta encontrada.</p>}
   <div className="flex items-center gap-3"><Button variant="outline" disabled={filter.page===1} onClick={()=>setFilter({...filter,page:filter.page-1})}>Contas anteriores</Button><span>Página {data.page} de {Math.max(1,Math.ceil(data.total/data.page_size))}</span><Button variant="outline" disabled={data.page*data.page_size>=data.total} onClick={()=>setFilter({...filter,page:filter.page+1})}>Próximas contas</Button></div>
  </>}
  {selected&&<><p className="font-medium">Conta selecionada: {selected.name}</p>
   <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();setPeriod({...dates});}}>
    <label>Início do saldo registrado<Input type="date" required value={dates.from} onChange={event=>setDates({...dates,from:event.target.value})}/></label>
    <label>Fim do saldo registrado<Input type="date" required min={dates.from} value={dates.to} onChange={event=>setDates({...dates,to:event.target.value})}/></label><Button>Consultar saldos</Button>
   </form>
   {selected.type===`cash`?<CashPeriodClosePanel key={`cash-close:${selected.id}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={selected.id} from={period.from} to={period.to}/>:<AccountPeriodClosePanel key={`close:${selected.id}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={selected.id} from={period.from} to={period.to}/>}
   <AccountOpeningReview key={`${selected.id}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={selected.id} from={period.from} to={period.to}/>
   <LegacyAdoptionInventory key={`legacy:${selected.id}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={selected.id} from={period.from} to={period.to} includeUnresolved={false}/>
  </>}
 </div>;
}
