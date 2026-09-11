import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {Button} from '@/components/ui/button';
import {readAutomaticReconciliationStatus} from '@/lib/financial/ledgerClient';
import {automaticReconciliationLabels,automaticReconciliationIssue} from '@/lib/financial/automaticReconciliationContract';
export function AutomaticReconciliationStatus({tenant,actor,statement}:{tenant:string;actor:string;statement:string}){
 const [open,setOpen]=useState(false),client=useQueryClient();
 const observed=useRef('');
 const query=useQuery({queryKey:['finance-automatic-reconciliation',tenant,actor,statement],enabled:open,retry:false,refetchInterval:open?30000:false,
  queryFn:()=>readAutomaticReconciliationStatus(tenant,statement)}),data=query.error?undefined:query.data;
 const revision=data?JSON.stringify([tenant,actor,statement,data.status,data.matched_count,data.updated_at]):'';
 useEffect(()=>{
  if(!revision||observed.current===revision)return;
  observed.current=revision;
  void invalidateAccountReview(client,tenant);
  for(const key of ['finance-reconciliation-history','finance-reconciliation-options','finance-statement-lines','finance-statements','finance-audit'])void client.invalidateQueries({queryKey:[key,tenant]});
 },[revision,client,tenant]);
 if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Acompanhar conciliação automática</Button>;
 return <section aria-label="Conciliação automática" className="space-y-2 rounded border p-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Conciliação automática</h2><Button variant="ghost" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar andamento</Button></div>
  {query.isPending&&<p role="status">Consultando andamento…</p>}{query.error&&<p role="alert">Não foi possível consultar o andamento.</p>}
  {data&&<><p className="font-medium">{automaticReconciliationLabels[data.status]}</p>
   {data.status==='pending'&&!data.scheduler_active&&<p role="alert">O processamento automático está desativado. A fila precisa ser ativada pela equipe responsável pelo sistema.</p>}
   {data.issue&&<p role="alert">{automaticReconciliationIssue(data.issue)}</p>}
   <p>{data.matched_count} vínculo(s) registrado(s) por esta conferência. Consulte o histórico para verificar revisões ou reversões posteriores.</p>
   {data.updated_at&&<p className="text-sm">Última atualização: {new Date(data.updated_at).toLocaleString('pt-BR')}</p>}
   <p className="text-sm">Varredura concluída não significa que todas as linhas foram conciliadas. Casos sem correspondência segura continuam pendentes. Esta etapa não certifica o saldo do período.</p>
  </>}
 </section>;
}
