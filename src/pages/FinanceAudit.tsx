import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import {readFinanceAudit} from '@/lib/financial/ledgerClient';
import {financeAuditActions,type FinanceAuditFilters} from '@/lib/financial/financeAuditContract';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
const initial:FinanceAuditFilters={page:1,page_size:30,from:'',to:'',action:'',actor_id:'',actor_search:'',search:'',manual_only:true};
export default function FinanceAudit(){
  const {currentTenant,currentRole}=useTenant(),{user}=useAuth(),access=useFinanceAccess();
  if(!currentTenant||!user)return <p>Entre e selecione a empresa.</p>;
  if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
  if(access.isPending)return <p role="status">Verificando acesso…</p>;
  if(access.error)return <p role="alert">Não foi possível verificar o acesso. <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
  if(!access.data)return <p role="alert">Acesso financeiro não permitido.</p>;
  return <AuditWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id}/>;
}
function AuditWorkspace({tenant,actor}:{tenant:string;actor:string}){
  const [filters,setFilters]=useState(initial),[draft,setDraft]=useState(initial),[actorName,setActorName]=useState('');
  const query=useQuery({queryKey:['finance-audit',tenant,actor,filters],retry:false,queryFn:()=>readFinanceAudit(tenant,filters)}),data=query.data;
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Auditoria financeira</h1>
    <p className="text-sm text-muted-foreground">Ações do novo registro financeiro, com responsáveis e justificativas preservados. Inclui decisões revertidas.</p></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setFilters({...draft,page:1});}}>
      <label className="text-sm">Responsável<Input value={draft.actor_search} maxLength={200} onChange={e=>setDraft({...draft,actor_search:e.target.value})} placeholder="Nome registrado no histórico"/></label>
      <label className="text-sm">Justificativa<Input value={draft.search} maxLength={200} onChange={e=>setDraft({...draft,search:e.target.value})}/></label>
      <label className="text-sm">De<Input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
      <label className="text-sm">Até<Input type="date" min={draft.from||undefined} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
      <label className="text-sm">Ação<select className="block h-10 rounded border bg-background px-2" value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value})}>
        <option value="">Todas</option>{Object.entries(financeAuditActions).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.manual_only} onChange={e=>setDraft({...draft,manual_only:e.target.checked})}/>Somente intervenções manuais</label>
      <Button type="submit">Filtrar</Button>
    </form>
    {filters.actor_id&&<p className="text-sm">Pessoa selecionada: {actorName} <Button variant="ghost" onClick={()=>{setDraft({...draft,actor_id:''});setFilters({...filters,page:1,actor_id:''});setActorName('');}}>Remover pessoa selecionada</Button></p>}
    <p className="text-xs text-muted-foreground">Datas e horários de Brasília. O nome mostrado é o registrado no momento da ação; alterações cadastrais posteriores não apagam essa identificação.</p>
    {query.isPending&&<p role="status">Carregando histórico…</p>}{query.error&&<p role="alert">Não foi possível consultar a auditoria. <Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
    {data&&!query.error&&<><p>{data.total} evento(s) no filtro · {data.manual_count} intervenção(ões) manual(is)</p>
      <div className="space-y-3">{data.rows.map(row=><article key={row.id} className={`rounded border p-4 ${row.manual_intervention?'border-amber-600':''}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{financeAuditActions[row.action]||'Ação financeira registrada'}</p>
          <p>{row.actor_name} · {new Date(row.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p></div>
          {row.manual_intervention&&<span className="rounded border border-amber-600 px-2 py-1 text-sm">Intervenção manual — histórico permanente</span>}</div>
        {row.statement_name&&<p className="mt-2 text-sm">{row.statement_name}{row.source_row?` · Registro ${row.source_row}`:''}</p>}
        {row.decision&&<p className="text-sm">{row.decision==='same_transaction'?'Identificada como a mesma transação':row.decision==='distinct_transaction'?'Identificada como outra transação':'Decisão registrada'}</p>}
        <p className="mt-2 whitespace-pre-wrap text-sm">{row.reason}</p>
        <Button variant="ghost" onClick={()=>{const next={...filters,page:1,actor_id:row.actor_id,actor_search:''};setActorName(row.actor_name);setDraft(next);setFilters(next);}}>Filtrar esta pessoa</Button>
      </article>)}{!data.rows.length&&<p>Nenhum evento neste filtro.</p>}</div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={filters.page===1||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page-1})}>Anterior</Button>
        <span>Página {data.page} de {Math.max(1,Math.ceil(data.total/data.page_size))}</span><Button variant="outline" disabled={data.page*data.page_size>=data.total||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page+1})}>Próxima</Button></div>
    </>}
  </div>;
}
