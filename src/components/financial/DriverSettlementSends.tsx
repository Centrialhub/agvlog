import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {readFinanceMovements} from '@/lib/financial/ledgerClient';
import {financeError,formatFinanceCents,type MovementFilters} from '@/lib/financial/ledgerContract';
import {FinanceAccessBoundary} from './FinanceAccessBoundary';
import {MovementEntryDialog} from './MovementEntryDialog';
import {MovementCorrectionDialog} from './MovementCorrectionDialog';
import {MovementInvalidationHistory} from './MovementInvalidationHistory';
import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
type Props={tenant:string;driver:{id:string;name:string}};
export function DriverSettlementSends({tenant,driver}:Props){
 const {user}=useAuth(),{currentTenant}=useTenant();
 if(!user||currentTenant?.id!==tenant)return <p role="alert">Selecione a empresa deste acerto para consultar os envios.</p>;
 return <FinanceAccessBoundary><DriverSettlementSendsWorkspace key={`${tenant}:${user.id}:${driver.id}`} tenant={tenant} actor={user.id} driver={driver}/></FinanceAccessBoundary>;
}
export function DriverSettlementSendsWorkspace({tenant,actor,driver}:Props&{actor:string}){
 const [dates,setDates]=useState({from:'',to:''}),[filters,setFilters]=useState<MovementFilters>({page:1,page_size:30,search:'',from:'',to:'',direction:'out',account_id:'',driver_id:driver.id});
 const [entry,setEntry]=useState(false),[correction,setCorrection]=useState<string|null>(null),[notice,setNotice]=useState('');
 const cache=useQueryClient(),query=useQuery({queryKey:['finance-movements',tenant,actor,filters],queryFn:()=>readFinanceMovements(tenant,filters),retry:false});
 const data=query.isFetching||query.isError?undefined:query.data;
 return <section className="space-y-3" aria-label="Envios ao motorista">
  <h3 className="font-semibold">Envios ao motorista</h3>
  <p>Saídas registradas para {driver.name} nesta empresa, inclusive durante a viagem. A consulta reúne os envios deste motorista; não comprova vínculo exclusivo com este acerto. O registro não quita o acerto nem confirma conciliação pelo extrato.</p>
  <Button onClick={()=>setEntry(true)}>Registrar envio realizado</Button>
  {notice&&<p role="status">{notice}</p>}
  <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();setFilters(old=>({...old,...dates,page:1}));}}>
   <div><Label htmlFor="driver-sends-from">Envios de</Label><Input id="driver-sends-from" type="date" value={dates.from} onChange={e=>setDates(old=>({...old,from:e.target.value}))}/></div>
   <div><Label htmlFor="driver-sends-to">Envios até</Label><Input id="driver-sends-to" type="date" value={dates.to} onChange={e=>setDates(old=>({...old,to:e.target.value}))}/></div>
   <Button type="submit">Filtrar envios</Button>
  </form>
  {query.isFetching&&<p role="status">Consultando envios…</p>}
  {query.error&&<p role="alert">{financeError(query.error)} <Button onClick={()=>void query.refetch()}>Atualizar envios</Button></p>}
  {data&&<><p>{data.total} registros · valor ativo: {formatFinanceCents(data.outflow_cents)} · originais invalidados: {formatFinanceCents(data.voided_outflow_cents)}</p>
   <table className="w-full text-sm"><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Valor original</th><th>Correção</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><td>{row.occurred_on.split('-').reverse().join('/')}</td><td>{row.account_name}</td><td>{row.description}</td><td>{formatFinanceCents(row.amount_cents)}</td><td>{row.correction?<MovementInvalidationHistory event={row.correction}/>:<span>Registro ativo</span>}<Button variant="link" onClick={()=>setCorrection(row.id)}>Corrigir ou excluir registro</Button></td></tr>)}</tbody></table>
   {!data.total&&<p>Nenhum envio neste filtro.</p>}
   <Button disabled={filters.page===1} onClick={()=>setFilters(old=>({...old,page:old.page-1}))}>Envios anteriores</Button><span> Página {data.page} </span><Button disabled={data.page*data.page_size>=data.total} onClick={()=>setFilters(old=>({...old,page:old.page+1}))}>Próximos envios</Button>
  </>}
  {entry&&<MovementEntryDialog tenant={tenant} actor={actor} initialDriver={driver} onClose={()=>setEntry(false)} onRecorded={()=>{setEntry(false);setNotice('Envio registrado. Confira a movimentação no extrato; nenhum pagamento de acerto foi criado.');void invalidateAccountReview(cache,tenant);for(const prefix of ['finance-movements','finance-audit','finance-reconciliation-options','finance-automatic-reconciliation'])void cache.invalidateQueries({queryKey:[prefix,tenant]});}}/>}
  {correction&&<MovementCorrectionDialog tenant={tenant} actor={actor} movementId={correction} onClose={()=>setCorrection(null)}/>}
 </section>;
}
