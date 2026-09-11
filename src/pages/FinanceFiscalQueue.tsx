import {FiscalEvidencePreview} from '@/components/financial/FiscalEvidencePreview';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import {readFiscalQueue} from '@/lib/financial/ledgerClient';
import {fiscalQueueIssue,fiscalQueueStatuses,type FiscalQueueStatus} from '@/lib/financial/fiscalQueueContract';
import {Button} from '@/components/ui/button';
const timestamp=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
export default function FinanceFiscalQueue(){
 const {currentTenant,currentRole}=useTenant(),{user}=useAuth(),access=useFinanceAccess();
 if(!currentTenant||!user)return <p>Entre e selecione a empresa.</p>;
 if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
 if(access.isPending)return <p role="status">Verificando acesso…</p>;
 if(access.error)return <p role="alert">Não foi possível verificar o acesso. <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
 if(!access.data)return <p role="alert">Acesso financeiro não permitido.</p>;
 return <QueueWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id}/>;
}
function QueueWorkspace({tenant,actor}:{tenant:string;actor:string}){
 const [status,setStatus]=useState<FiscalQueueStatus>('review'),[page,setPage]=useState(1);
 const query=useQuery({queryKey:['finance-fiscal-queue',tenant,actor,status,page],retry:false,refetchInterval:30000,
  queryFn:()=>readFiscalQueue(tenant,status,page)}),data=query.error?undefined:query.data;
 return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Recebíveis fiscais</h1>
  <p className="text-sm text-muted-foreground">Acompanhe a geração e a atualização das cobranças de CT-e e NFS-e. Processado não significa recebido ou conciliado com o banco.</p></div>
  <div className="flex flex-wrap items-end gap-3"><label>Situação<select className="block h-10 rounded border bg-background px-3" value={status} onChange={e=>{setStatus(e.target.value as FiscalQueueStatus);setPage(1);}}>
   <option value="">Todas</option>{Object.entries(fiscalQueueStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar</Button></div>
  {query.isPending&&<p role="status">Consultando processamento…</p>}{query.error&&<p role="alert">Não foi possível consultar o processamento. Tente atualizar.</p>}
  {data&&<>{!data.scheduler_active&&<p role="alert">O processamento automático não está ativo. Solicite a ativação para que os documentos pendentes sejam processados.</p>}
   <dl className="grid gap-3 sm:grid-cols-4">{Object.entries(data.counts).map(([key,value])=><div key={key} className="rounded border p-3"><dt>{fiscalQueueStatuses[key as keyof typeof fiscalQueueStatuses]}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}</dl>
   <p>{data.total} registro(s) no filtro. Horários de Brasília. Atualização a cada 30 segundos.</p>
   <div className="space-y-3">{data.rows.map(row=><article key={row.observation_id} className={`rounded border p-4 ${row.status==='review'?'border-amber-600':''}`}>
    <p className="font-semibold">{row.document_type==='cte'?'CT-e':'NFS-e'} {row.document_number||'sem número'} · {fiscalQueueStatuses[row.status]}</p>
    <p className="text-sm">Registrado em {timestamp(row.created_at)} · Atualizado em {timestamp(row.updated_at)}</p>
    {row.issue&&<p className="mt-2">{fiscalQueueIssue(row.issue)}</p>}
    {row.status==='pending'&&row.automatic_failures>0&&<p className="text-sm">Próxima tentativa a partir de {timestamp(row.available_at)}.</p>}
    <p className="text-sm">{row.attempts} tentativa(s) · {row.automatic_failures} falha(s) automática(s)</p>
    <FiscalEvidencePreview tenant={tenant} actor={actor} observation={row.observation_id}/>
   </article>)}{!data.rows.length&&<p>Nenhum registro neste filtro.</p>}</div>
   <div className="flex items-center justify-between"><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Anterior</Button>
    <span>Página {data.page} de {Math.max(1,Math.ceil(data.total/data.page_size))}</span>
    <Button variant="outline" disabled={page*data.page_size>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próxima</Button></div>
  </>}
 </div>;
}
